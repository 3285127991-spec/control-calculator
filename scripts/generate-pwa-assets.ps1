$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$iconDir = Join-Path $root "public\icons"
$splashDir = Join-Path $root "public\splash"
New-Item -ItemType Directory -Force -Path $iconDir, $splashDir | Out-Null

function New-Brush($r, $g, $b, $a = 255) {
  return [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb($a, $r, $g, $b))
}

function New-IconPng($path, $size, $maskable) {
  $bitmap = [System.Drawing.Bitmap]::new($size, $size)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(8, 10, 18))

  $rect = [System.Drawing.Rectangle]::new(0, 0, $size, $size)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(22, 119, 255),
    [System.Drawing.Color]::FromArgb(22, 200, 183),
    135
  )
  $graphics.FillRectangle($gradient, $rect)

  $graphics.FillEllipse((New-Brush 124 58 237 120), [int]($size * 0.45), [int](-$size * 0.08), [int]($size * 0.72), [int]($size * 0.72))
  $graphics.FillEllipse((New-Brush 255 255 255 34), [int](-$size * 0.16), [int]($size * 0.58), [int]($size * 0.66), [int]($size * 0.66))

  $safeInset = if ($maskable) { [int]($size * 0.22) } else { [int]($size * 0.16) }
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::FromArgb(235, 255, 255, 255), [Math]::Max(5, [int]($size * 0.035)))
  $pathLine = [System.Drawing.Drawing2D.GraphicsPath]::new()
  $pathLine.AddBezier(
    $safeInset,
    [int]($size * 0.64),
    [int]($size * 0.34),
    [int]($size * 0.22),
    [int]($size * 0.55),
    [int]($size * 0.82),
    $size - $safeInset,
    [int]($size * 0.36)
  )
  $graphics.DrawPath($pen, $pathLine)

  $fontSize = if ($maskable) { [int]($size * 0.18) } else { [int]($size * 0.2) }
  $font = [System.Drawing.Font]::new("Segoe UI", $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString("CL", $font, (New-Brush 255 255 255), [System.Drawing.RectangleF]::new(0, 0, $size, $size), $format)

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

function New-SplashPng($path, $width, $height) {
  $bitmap = [System.Drawing.Bitmap]::new($width, $height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([System.Drawing.Color]::FromArgb(8, 10, 18))

  $rect = [System.Drawing.Rectangle]::new(0, 0, $width, $height)
  $gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
    $rect,
    [System.Drawing.Color]::FromArgb(8, 10, 18),
    [System.Drawing.Color]::FromArgb(18, 24, 39),
    135
  )
  $graphics.FillRectangle($gradient, $rect)
  $graphics.FillEllipse((New-Brush 22 119 255 70), [int](-$width * 0.22), [int]($height * 0.04), [int]($width * 0.78), [int]($width * 0.78))
  $graphics.FillEllipse((New-Brush 22 200 183 50), [int]($width * 0.54), [int]($height * 0.08), [int]($width * 0.72), [int]($width * 0.72))
  $graphics.FillEllipse((New-Brush 124 58 237 46), [int]($width * 0.18), [int]($height * 0.72), [int]($width * 0.74), [int]($width * 0.74))

  $iconSize = [int]($width * 0.24)
  $icon = [System.Drawing.Image]::FromFile((Join-Path $iconDir "icon-512.png"))
  $graphics.DrawImage($icon, [int](($width - $iconSize) / 2), [int]($height * 0.38), $iconSize, $iconSize)
  $icon.Dispose()

  $titleFont = [System.Drawing.Font]::new("Segoe UI", [int]($width * 0.055), [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $subFont = [System.Drawing.Font]::new("Segoe UI", [int]($width * 0.028), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $format = [System.Drawing.StringFormat]::new()
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $graphics.DrawString("Control AI Lab", $titleFont, (New-Brush 244 247 255), [System.Drawing.RectangleF]::new(0, [int]($height * 0.51), $width, 90), $format)
  $graphics.DrawString("Bode - Root Locus - Step Response", $subFont, (New-Brush 190 210 235), [System.Drawing.RectangleF]::new(0, [int]($height * 0.56), $width, 70), $format)

  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose()
  $bitmap.Dispose()
}

New-IconPng (Join-Path $iconDir "icon-192.png") 192 $false
New-IconPng (Join-Path $iconDir "icon-512.png") 512 $false
New-IconPng (Join-Path $iconDir "icon-maskable-512.png") 512 $true
Copy-Item (Join-Path $iconDir "icon-192.png") (Join-Path $iconDir "apple-touch-icon.png") -Force
New-SplashPng (Join-Path $splashDir "splash-1170x2532.png") 1170 2532
New-SplashPng (Join-Path $splashDir "splash-1290x2796.png") 1290 2796
