# Opens each .pptx in a folder with your installed PowerPoint and saves every slide as a PNG, exactly as PowerPoint
# draws it, so the decks can be checked as the final product.
#
# Usage (PowerShell, in the folder holding the decks):
#   powershell -ExecutionPolicy Bypass -File pptx-to-png.ps1
#   powershell -ExecutionPolicy Bypass -File pptx-to-png.ps1 -Folder "C:\Users\me\Downloads\decks"
# The pictures go into "<deck name> - slides" next to each deck. Nothing is changed in the decks.
param([string]$Folder = (Get-Location).Path, [int]$Width = 1600)

$ppt = New-Object -ComObject PowerPoint.Application
try {
  Get-ChildItem -Path $Folder -Filter *.pptx | ForEach-Object {
    $out = Join-Path $_.DirectoryName ("{0} - slides" -f $_.BaseName)
    New-Item -ItemType Directory -Force -Path $out | Out-Null
    # ReadOnly, Untitled, no window
    $deck = $ppt.Presentations.Open($_.FullName, $true, $false, $false)
    $height = [int]($Width * $deck.PageSetup.SlideHeight / $deck.PageSetup.SlideWidth)
    foreach ($slide in $deck.Slides) {
      $file = Join-Path $out ("slide-{0:D2}.png" -f $slide.SlideIndex)
      $slide.Export($file, "PNG", $Width, $height)
    }
    Write-Host ("{0}: {1} slides -> {2}" -f $_.Name, $deck.Slides.Count, $out)
    $deck.Close()
  }
} finally {
  $ppt.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
}
