# Makes a 16 kHz mono 16-bit test WAV with spoken text, for testing voice input.
# Usage: make-test-wav.ps1 -Out <path> [-Text <string>]
# Picks an installed sv-SE voice when there is one, otherwise en-US.
# Swedish characters are written as [char] codes so the script works regardless of file encoding.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Text
)

Add-Type -AssemblyName System.Speech

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $sv = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'sv-SE' } | Select-Object -First 1
  if ($sv) {
    $synth.SelectVoice($sv.VoiceInfo.Name)
    $voiceName = $sv.VoiceInfo.Name
    $defaultText = 'L' + [char]0xE4 + 'gg till en knapp som sparar filen. Alternativ tv' + [char]0xE5 + '.'
  } else {
    $en = $synth.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'en-US' } | Select-Object -First 1
    if ($en) { $synth.SelectVoice($en.VoiceInfo.Name); $voiceName = $en.VoiceInfo.Name }
    else { $voiceName = '(default)' }
    $defaultText = 'Please add a button that saves the file. Option two.'
  }
  if (-not $PSBoundParameters.ContainsKey('Text')) { $Text = $defaultText }

  $dir = Split-Path -Parent $Out
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

  $format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
  $synth.SetOutputToWaveFile($Out, $format)

  # Silence before and after the speech, so the silence detector sees quiet on both sides.
  $pb = New-Object System.Speech.Synthesis.PromptBuilder
  $pb.AppendBreak([TimeSpan]::FromSeconds(0.7))
  $pb.AppendText($Text)
  $pb.AppendBreak([TimeSpan]::FromSeconds(3.5))
  $synth.Speak($pb)
  $synth.SetOutputToNull()
  Write-Output "Voice: $voiceName"
  Write-Output "WAV: $Out"
} finally {
  $synth.Dispose()
}
