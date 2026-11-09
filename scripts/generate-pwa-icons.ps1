Add-Type -AssemblyName System.Drawing

$outDir = Join-Path $PSScriptRoot '..\public'
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

function New-CampusCabIcon {
  param(
    [int]$Size,
    [string]$FileName,
    [double]$GlyphScale = 1.0
  )

  $brand = [System.Drawing.ColorTranslator]::FromHtml('#4338ca')
  $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  # Full-bleed brand background: iOS rounds the corners itself, Android masks it.
  $bg = New-Object System.Drawing.SolidBrush($brand)
  $g.FillRectangle($bg, 0, 0, $Size, $Size)

  $white = [System.Drawing.Brushes]::White
  $fontSize = [single]([double]$Size * 0.34 * $GlyphScale)
  $font = New-Object System.Drawing.Font(
    'Segoe UI',
    $fontSize,
    [System.Drawing.FontStyle]::Bold,
    [System.Drawing.GraphicsUnit]::Pixel
  )

  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $sf.LineAlignment = [System.Drawing.StringAlignment]::Center

  $textBoxHeight = [single]([double]$Size * 0.62)
  $textTop = [single]([double]$Size * 0.13)
  $rect = New-Object System.Drawing.RectangleF(
    ([single]0),
    $textTop,
    ([single]$Size),
    $textBoxHeight
  )
  $g.DrawString('CC', $font, $white, $rect, $sf)

  # Short ride bar under the letters — reads as a road / cab roofline at small sizes.
  $barWidth = [double]$Size * 0.36 * $GlyphScale
  $barHeight = [double]$Size * 0.055 * $GlyphScale
  $barX = ([double]$Size - $barWidth) / 2.0
  $barY = [double]$Size * 0.70
  $g.FillRectangle(
    $white,
    [int][Math]::Round($barX),
    [int][Math]::Round($barY),
    [int][Math]::Max(2, [Math]::Round($barWidth)),
    [int][Math]::Max(2, [Math]::Round($barHeight))
  )

  $path = Join-Path $outDir $FileName
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
  Write-Output ("{0}  {1}x{1}  {2} bytes" -f $FileName, $Size, (Get-Item $path).Length)
}

New-CampusCabIcon -Size 192 -FileName 'icon-192.png'
New-CampusCabIcon -Size 512 -FileName 'icon-512.png'
# Maskable icons are cropped by the launcher, so keep the glyph inside the safe zone.
New-CampusCabIcon -Size 512 -FileName 'icon-maskable-512.png' -GlyphScale 0.72
New-CampusCabIcon -Size 180 -FileName 'apple-touch-icon.png'
