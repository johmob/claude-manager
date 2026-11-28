# Outlook bridge: a long-lived PowerShell 5.1 process that talks to the running classic Outlook through COM.
# Protocol: one JSON object per line on stdin ({ id, op, args }), one JSON line back on stdout
# ({ id, ok: true, result } or { id, ok: false, error, code }). Nothing else is ever written to stdout.
# It never starts Outlook, never opens a window and never sends anything except through the ops below:
# `reply` (an existing item) and `send-to-self` (the account's own address only; there is no recipient argument).
# Mail content is never logged; errors carry COM messages only.
param([int]$ParentPid = 0)

$ErrorActionPreference = 'Stop'
$utf8 = New-Object Text.UTF8Encoding $false
$stdin = New-Object IO.StreamReader([Console]::OpenStandardInput(), $utf8)
$stdout = New-Object IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
$stdout.AutoFlush = $true
$stdout.NewLine = "`n"

# ---------- exit when the parent is gone ----------
# stdin closing already ends the loop; this covers a parent that vanished without closing the pipe.
if ($ParentPid -gt 0) {
  $watchRs = [runspacefactory]::CreateRunspace()
  $watchRs.Open()
  $watch = [powershell]::Create()
  $watch.Runspace = $watchRs
  [void]$watch.AddScript({
    param($p)
    while ($true) {
      Start-Sleep -Seconds 20
      if (-not (Get-Process -Id $p -ErrorAction SilentlyContinue)) { [Environment]::Exit(0) }
    }
  }).AddArgument($ParentPid)
  [void]$watch.BeginInvoke()
}

# ---------- constants ----------
$PA_INTERNET_ID = 'http://schemas.microsoft.com/mapi/proptag/0x1035001F'
$PA_SENDER_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x5D01001F'
$PA_RECIP_SMTP = 'http://schemas.microsoft.com/mapi/proptag/0x39FE001F'
$PA_HEADERS = 'http://schemas.microsoft.com/mapi/proptag/0x007D001F'
$PA_CONTENT_ID = 'http://schemas.microsoft.com/mapi/proptag/0x3712001F'
$PA_SEND_TOKEN = 'http://schemas.microsoft.com/mapi/string/{00020329-0000-0000-C000-000000000046}/CMSendToken'
$MAX_BODY = 100000
$MAX_HTML = 1000000
$MAX_HEADERS = 16384

$script:ol = $null
$script:ns = $null
$script:smtpCache = @{}
$script:accountCache = $null
$script:sentFolderId = $null
$script:inboxFolderId = $null

# ---------- helpers ----------
function Fail([string]$code, [string]$message) { throw "CM:${code}:$message" }

function Get-Outlook {
  if ($script:ol) {
    try { $null = $script:ol.Version; return $script:ol } catch { $script:ol = $null; $script:ns = $null }
  }
  try {
    $script:ol = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  } catch {
    Fail 'not-running' 'Outlook is not running (or runs with different rights).'
  }
  return $script:ol
}

function Get-Ns {
  $null = Get-Outlook
  if (-not $script:ns) { $script:ns = $script:ol.GetNamespace('MAPI') }
  return $script:ns
}

function Reset-Outlook {
  $script:ol = $null
  $script:ns = $null
  $script:accountCache = $null
  $script:sentFolderId = $null
  $script:inboxFolderId = $null
}

function Prop($obj, [string]$schema) {
  try { $v = $obj.PropertyAccessor.GetProperty($schema); if ($null -eq $v) { return '' } else { return [string]$v } } catch { return '' }
}

function Str($v) { if ($null -eq $v) { return '' } else { return [string]$v } }

function To-Iso($d) {
  try { return ([DateTime]$d).ToUniversalTime().ToString('o') } catch { return '' }
}

function Parse-Iso([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return [DateTime]::MinValue.ToUniversalTime() }
  return [DateTime]::Parse($s, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
}

function Get-HResults($ex) {
  $list = @()
  for ($e = $ex; $null -ne $e; $e = $e.InnerException) { try { $list += [int]$e.HResult } catch {} }
  return $list
}

# Disconnected / server gone: Outlook restarted.
$DISCONNECTED = @(-2147417848, -2147023174, -2147023170, -2147023173)   # 0x80010108, 0x800706BA, 0x800706BE, 0x800706BB
# Outlook busy (modal dialog): worth a short wait.
$BUSY = @(-2147418111, -2147417846)   # 0x80010001, 0x8001010A

# ---------- addresses ----------
function Smtp-Of-AddressEntry($ae) {
  if ($null -eq $ae) { return '' }
  try {
    $t = Str $ae.Type
    if ($t -eq 'EX') {
      $u = $ae.GetExchangeUser()
      if ($u -and $u.PrimarySmtpAddress) { return [string]$u.PrimarySmtpAddress }
      $dl = $ae.GetExchangeDistributionList()
      if ($dl -and $dl.PrimarySmtpAddress) { return [string]$dl.PrimarySmtpAddress }
      return ''
    }
    return Str $ae.Address
  } catch { return '' }
}

function Sender-Of($item) {
  $name = ''
  $addr = ''
  try { $name = Str $item.SenderName } catch {}
  $type = ''
  $raw = ''
  try { $type = Str $item.SenderEmailType } catch {}
  try { $raw = Str $item.SenderEmailAddress } catch {}
  if ($type -eq 'EX' -and $raw) {
    if ($script:smtpCache.ContainsKey($raw)) { $addr = $script:smtpCache[$raw] }
    else {
      $addr = Prop $item $PA_SENDER_SMTP
      if (-not $addr) { try { $addr = Smtp-Of-AddressEntry $item.Sender } catch {} }
      if ($addr) { $script:smtpCache[$raw] = $addr }
    }
  } elseif ($type -eq 'SMTP' -or ($raw -match '@')) {
    $addr = $raw
  } else {
    $addr = Prop $item $PA_SENDER_SMTP
    if (-not $addr) { $addr = $raw }
  }
  return @{ name = $name; address = $addr }
}

function Recipients-Of($item) {
  $to = New-Object Collections.ArrayList
  $cc = New-Object Collections.ArrayList
  try {
    $rs = $item.Recipients
    $n = $rs.Count
    for ($i = 1; $i -le $n; $i++) {
      try {
        $r = $rs.Item($i)
        $type = [int]$r.Type
        if ($type -ne 1 -and $type -ne 2) { continue }
        $addr = Prop $r $PA_RECIP_SMTP
        if (-not $addr) {
          $raw = Str $r.Address
          if ($raw -match '^/o=' -or $raw -match '^/O=') {
            if ($script:smtpCache.ContainsKey($raw)) { $addr = $script:smtpCache[$raw] }
            else { $addr = Smtp-Of-AddressEntry $r.AddressEntry; if ($addr) { $script:smtpCache[$raw] = $addr } }
          } else { $addr = $raw }
        }
        $rec = @{ name = (Str $r.Name); address = $addr }
        if ($type -eq 1) { [void]$to.Add($rec) } else { [void]$cc.Add($rec) }
      } catch {}
    }
  } catch {}
  return @{ to = @($to); cc = @($cc) }
}

# ---------- folders and items ----------
function Folder-Of([string]$name) {
  $ns = Get-Ns
  if ($name -eq 'sent') { return $ns.GetDefaultFolder(5) }
  return $ns.GetDefaultFolder(6)
}

function Get-Item-By-Id([string]$entryId) {
  if ([string]::IsNullOrEmpty($entryId)) { Fail 'not-found' 'No item id.' }
  try { return (Get-Ns).GetItemFromID($entryId) } catch {
    foreach ($h in (Get-HResults $_.Exception)) { if ($DISCONNECTED -contains $h) { throw } }
    Fail 'not-found' 'The item was not found.'
  }
}

# Which folder an item is in, as far as this bridge cares. (MailItem.Sent is true for received mail too, so it says nothing.)
function Folder-Kind($item) {
  $ns = Get-Ns
  if (-not $script:sentFolderId) {
    try { $script:sentFolderId = Str $ns.GetDefaultFolder(5).EntryID } catch { $script:sentFolderId = '?' }
    try { $script:inboxFolderId = Str $ns.GetDefaultFolder(6).EntryID } catch { $script:inboxFolderId = '?' }
  }
  $parentId = ''
  try { $parentId = Str $item.Parent.EntryID } catch {}
  if ($parentId -eq $script:sentFolderId) { return 'sent' }
  if ($parentId -eq $script:inboxFolderId) { return 'inbox' }
  # Another folder (a rule's target, a subfolder): sent when the sender is the account itself.
  $own = (Op-Account $null).address
  $from = (Sender-Of $item).address
  if ($own -and $from -and $own.ToLowerInvariant() -eq $from.ToLowerInvariant()) { return 'sent' }
  return 'inbox'
}

function Header-Of($item, [string]$folder, [bool]$withHeaders) {
  $cls = ''
  try { $cls = Str $item.MessageClass } catch {}
  $unread = $false
  try { $unread = [bool]$item.UnRead } catch {}
  $subject = ''
  try { $subject = Str $item.Subject } catch {}
  $at = ''
  try { if ($folder -eq 'sent') { $at = To-Iso $item.SentOn } else { $at = To-Iso $item.ReceivedTime } } catch {}
  $entryId = ''
  try { $entryId = Str $item.EntryID } catch {}
  $storeId = ''
  try { $storeId = Str $item.Parent.StoreID } catch {}
  $conv = ''
  try { $conv = Str $item.ConversationID } catch {}
  $from = @{ name = ''; address = '' }
  $rec = @{ to = @(); cc = @() }
  if ($folder -eq 'sent') {
    # Own sent mail: sender is the account itself; recipients matter.
    $from = Sender-Of $item
    $rec = Recipients-Of $item
  } else {
    $from = Sender-Of $item
    $rec = Recipients-Of $item
  }
  $atts = New-Object Collections.ArrayList
  try {
    $as = $item.Attachments
    $n = $as.Count
    for ($i = 1; $i -le $n; $i++) {
      try {
        $a = $as.Item($i)
        $cid = Prop $a $PA_CONTENT_ID
        $inline = $cid -ne ''
        [void]$atts.Add(@{ index = $i; name = (Str $a.FileName); size = [int64]$a.Size; inline = $inline; contentId = $cid })
      } catch {}
    }
  } catch {}
  $raw = ''
  if ($withHeaders -and $folder -ne 'sent') {
    $raw = Prop $item $PA_HEADERS
    if ($raw.Length -gt $MAX_HEADERS) { $raw = $raw.Substring(0, $MAX_HEADERS) }
  }
  $token = ''
  if ($folder -eq 'sent') { $token = Prop $item $PA_SEND_TOKEN }
  return [ordered]@{
    entryId = $entryId
    storeId = $storeId
    internetId = (Prop $item $PA_INTERNET_ID)
    conversationId = $conv
    folder = $folder
    messageClass = $cls
    from = $from
    to = @($rec.to)
    cc = @($rec.cc)
    subject = $subject
    at = $at
    unread = $unread
    attachments = @($atts)
    rawHeaders = $raw
    sendToken = $token
  }
}

# ---------- ops ----------
function Op-Hello($a) {
  $attached = $false
  $ver = ''
  try { $o = Get-Outlook; $attached = $true; $ver = Str $o.Version } catch {}
  return @{
    languageMode = [string]$ExecutionContext.SessionState.LanguageMode
    psVersion = [string]$PSVersionTable.PSVersion
    outlookVersion = $ver
    attached = $attached
  }
}

function Op-Account($a) {
  if ($script:accountCache) { return $script:accountCache }
  $ns = Get-Ns
  $addr = ''
  $display = ''
  try {
    foreach ($acc in $ns.Accounts) {
      if ($acc.AccountType -eq 0 -and $acc.SmtpAddress) { $addr = Str $acc.SmtpAddress; $display = Str $acc.DisplayName; break }
    }
    if (-not $addr) {
      foreach ($acc in $ns.Accounts) {
        if ($acc.SmtpAddress) { $addr = Str $acc.SmtpAddress; $display = Str $acc.DisplayName; break }
      }
    }
  } catch {}
  if (-not $addr) {
    try { $addr = Str $ns.CurrentUser.AddressEntry.GetExchangeUser().PrimarySmtpAddress; $display = Str $ns.CurrentUser.Name } catch {}
  }
  $res = @{ address = $addr; displayName = $display; found = [bool]$addr }
  if ($addr) { $script:accountCache = $res }
  return $res
}

function Op-ListSince($a) {
  $folder = if ($a.folder -eq 'sent') { 'sent' } else { 'inbox' }
  $since = Parse-Iso (Str $a.since)
  $max = if ($a.max) { [int]$a.max } else { 50 }
  $prefix = Str $a.subjectPrefix
  $f = Folder-Of $folder
  $items = $f.Items
  $field = if ($folder -eq 'sent') { '[SentOn]' } else { '[ReceivedTime]' }
  $items.Sort($field, $true)
  $out = New-Object Collections.ArrayList
  $scanned = 0
  $item = $items.GetFirst()
  while ($null -ne $item -and $out.Count -lt $max -and $scanned -lt ($max * 4 + 50)) {
    $scanned++
    $when = $null
    try { if ($folder -eq 'sent') { $when = $item.SentOn } else { $when = $item.ReceivedTime } } catch {}
    if ($null -ne $when) {
      # Items at exactly `since` are included: the node side drops the ones it has seen.
      if (([DateTime]$when).ToUniversalTime() -lt $since) { break }
      $take = $true
      if ($prefix) {
        $s = ''
        try { $s = Str $item.Subject } catch {}
        $take = $s.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
      }
      if ($take) { [void]$out.Add((Header-Of $item $folder $true)) }
    }
    $item = $items.GetNext()
  }
  return @{ items = @($out) }
}

function Op-Get($a) {
  $item = Get-Item-By-Id (Str $a.entryId)
  $folder = Folder-Kind $item
  $h = Header-Of $item $folder $true
  $body = ''
  try { $body = Str $item.Body } catch {}
  $truncated = $false
  if ($body.Length -gt $MAX_BODY) { $body = $body.Substring(0, $MAX_BODY); $truncated = $true }
  $h['bodyText'] = $body
  $h['truncated'] = $truncated
  $h['bodyHtml'] = $null
  if ($a.html) {
    $html = ''
    try { $html = Str $item.HTMLBody } catch {}
    if ($html) {
      if ($html.Length -gt $MAX_HTML) { $html = $html.Substring(0, $MAX_HTML) }
      $h['bodyHtml'] = $html
    }
  }
  return $h
}

function Op-Conversation($a) {
  $item = Get-Item-By-Id (Str $a.entryId)
  $conv = $null
  try { $conv = $item.GetConversation() } catch {}
  if ($null -eq $conv) { return @{ items = @() } }
  $skip = @{}
  $ns = Get-Ns
  foreach ($code in 3, 4, 16, 23) {
    try { $skip[(Str $ns.GetDefaultFolder($code).EntryID)] = $true } catch {}
  }
  $out = New-Object Collections.ArrayList
  $tbl = $conv.GetTable()
  $guard = 0
  while (-not $tbl.EndOfTable -and $guard -lt 200) {
    $guard++
    $row = $tbl.GetNextRow()
    try {
      $m = $ns.GetItemFromID((Str $row.Item('EntryID')))
      $parentId = ''
      try { $parentId = Str $m.Parent.EntryID } catch {}
      if ($skip.ContainsKey($parentId)) { continue }
      $folder = Folder-Kind $m
      [void]$out.Add((Header-Of $m $folder $true))
    } catch {}
  }
  return @{ items = @($out) }
}

function Op-UnreadOf($a) {
  $out = New-Object Collections.ArrayList
  $ns = Get-Ns
  foreach ($id in @($a.entryIds)) {
    try {
      $m = $ns.GetItemFromID([string]$id)
      if ($m.UnRead) { [void]$out.Add([string]$id) }
    } catch {
      foreach ($h in (Get-HResults $_.Exception)) { if ($DISCONNECTED -contains $h) { throw } }
    }
  }
  return @{ unread = @($out) }
}

function Op-Reply($a) {
  $item = Get-Item-By-Id (Str $a.entryId)
  $paths = @($a.attachments | Where-Object { $_ })
  foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { Fail 'not-found' 'An attachment file does not exist.' }
  }
  $r = if ($a.replyAll) { $item.ReplyAll() } else { $item.Reply() }
  try {
    if ([int]$r.BodyFormat -ne 2) { $r.BodyFormat = 2 }
    $html = Str $r.HTMLBody
    $insert = Str $a.html
    $m = [regex]::Match($html, '<body[^>]*>', 'IgnoreCase')
    if ($m.Success) { $html = $html.Substring(0, $m.Index + $m.Length) + $insert + $html.Substring($m.Index + $m.Length) }
    else { $html = $insert + $html }
    $r.HTMLBody = $html
    foreach ($p in $paths) { [void]$r.Attachments.Add($p) }
    $token = Str $a.token
    if ($token) { $r.PropertyAccessor.SetProperty($PA_SEND_TOKEN, $token) }
  } catch {
    try { $r.Delete() } catch {}
    throw
  }
  $r.Send()
  return @{ sent = $true }
}

function Op-FindSent($a) {
  $token = Str $a.token
  if (-not $token) { return @{ item = $null } }
  $within = if ($a.withinMinutes) { [int]$a.withinMinutes } else { 60 }
  $cut = (Get-Date).ToUniversalTime().AddMinutes(-$within)
  $items = (Folder-Of 'sent').Items
  $items.Sort('[SentOn]', $true)
  $item = $items.GetFirst()
  $scanned = 0
  while ($null -ne $item -and $scanned -lt 300) {
    $scanned++
    $when = $null
    try { $when = $item.SentOn } catch {}
    if ($null -ne $when -and ([DateTime]$when).ToUniversalTime() -lt $cut) { break }
    if ((Prop $item $PA_SEND_TOKEN) -eq $token) { return @{ item = (Header-Of $item 'sent' $false) } }
    $item = $items.GetNext()
  }
  return @{ item = $null }
}

function Op-MarkRead($a) {
  $item = Get-Item-By-Id (Str $a.entryId)
  if ($item.UnRead) { $item.UnRead = $false; $item.Save() }
  return @{ done = $true }
}

function Op-SaveAttachment($a) {
  $item = Get-Item-By-Id (Str $a.entryId)
  $path = Str $a.path
  if (-not $path) { Fail 'failed' 'No target path.' }
  $att = $null
  try { $att = $item.Attachments.Item([int]$a.index) } catch { Fail 'not-found' 'The attachment was not found.' }
  $att.SaveAsFile($path)
  return @{ done = $true }
}

function Op-SendToSelf($a) {
  $acc = Op-Account $null
  $addr = Str $acc.address
  if (-not $addr) { Fail 'refused' 'The account address is unknown; refusing to send.' }
  $ol = Get-Outlook
  $m = $ol.CreateItem(0)
  try {
    $m.Subject = Str $a.subject
    $m.Body = Str $a.text
    $rcp = $m.Recipients.Add($addr)
    [void]$rcp.Resolve()
    if ($m.Recipients.Count -ne 1) { Fail 'refused' 'Unexpected recipient count; refusing to send.' }
    $resolved = Prop $rcp $PA_RECIP_SMTP
    if (-not $resolved) { $resolved = Smtp-Of-AddressEntry $rcp.AddressEntry }
    if (-not $resolved) { $resolved = Str $rcp.Address }
    if (-not $resolved) { Fail 'refused' 'The recipient did not resolve; refusing to send.' }
    if ($resolved.ToLowerInvariant() -ne $addr.ToLowerInvariant()) { Fail 'refused' 'The recipient is not the account address; refusing to send.' }
  } catch {
    try { $m.Delete() } catch {}
    throw
  }
  $m.Send()
  return @{ sent = $true }
}

# ---------- dispatch ----------
function Invoke-Op([string]$op, $a) {
  switch ($op) {
    'hello' { return Op-Hello $a }
    'account' { return Op-Account $a }
    'list-since' { return Op-ListSince $a }
    'get' { return Op-Get $a }
    'conversation' { return Op-Conversation $a }
    'unread-of' { return Op-UnreadOf $a }
    'reply' { return Op-Reply $a }
    'find-sent' { return Op-FindSent $a }
    'mark-read' { return Op-MarkRead $a }
    'save-attachment' { return Op-SaveAttachment $a }
    'send-to-self' { return Op-SendToSelf $a }
    'ping' { return @{ pong = $true } }
    default { Fail 'failed' "Unknown op: $op" }
  }
}

function Classify($ex) {
  $msg = [string]$ex.Message
  if ($msg -match '^CM:([a-z-]+):(.*)$') { return @{ code = $Matches[1]; error = $Matches[2] } }
  foreach ($h in (Get-HResults $ex)) { if ($DISCONNECTED -contains $h) { return @{ code = 'disconnected'; error = 'Lost the connection to Outlook.' } } }
  return @{ code = 'failed'; error = $msg }
}

function Run-Request($req) {
  $op = Str $req.op
  $a = $req.args
  if ($null -eq $a) { $a = [pscustomobject]@{} }
  $attempt = 0
  while ($true) {
    $attempt++
    try {
      $res = Invoke-Op $op $a
      return @{ id = $req.id; ok = $true; result = $res }
    } catch {
      $hr = Get-HResults $_.Exception
      $disc = $false
      $busy = $false
      foreach ($h in $hr) { if ($DISCONNECTED -contains $h) { $disc = $true }; if ($BUSY -contains $h) { $busy = $true } }
      # Retry once after dropping the cached object; sending is never retried (it could double-send).
      $mutating = ($op -eq 'reply' -or $op -eq 'send-to-self')
      if ($attempt -lt 2 -and -not $mutating -and ($disc -or $busy)) {
        if ($disc) { Reset-Outlook } else { Start-Sleep -Milliseconds 1500 }
        continue
      }
      if ($disc) { Reset-Outlook }
      $c = Classify $_.Exception
      return @{ id = $req.id; ok = $false; error = $c.error; code = $c.code }
    }
  }
}

# ---------- main loop ----------
while ($true) {
  $line = $stdin.ReadLine()
  if ($null -eq $line) { break }
  if ($line.Trim().Length -eq 0) { continue }
  $reply = $null
  try {
    $req = $line | ConvertFrom-Json
    $reply = Run-Request $req
  } catch {
    $reply = @{ id = $null; ok = $false; error = 'Bad request.'; code = 'failed' }
  }
  try {
    $json = ConvertTo-Json -InputObject $reply -Compress -Depth 8
  } catch {
    $json = ConvertTo-Json -InputObject @{ id = $reply.id; ok = $false; error = 'Could not encode the reply.'; code = 'failed' } -Compress
  }
  $stdout.WriteLine($json)
}
