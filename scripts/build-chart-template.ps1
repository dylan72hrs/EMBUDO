# Genera templates/dashboard_chart_template.xlsx con graficos nativos de Excel
# preformateados (estilos de "Estilos de grafico" + formato corporativo).
#
# Estructura del template:
#   - Hoja "Dashboard_Data": headers + datos de muestra (NO se copia al output;
#     los graficos resuelven por nombre contra la Dashboard_Data real).
#   - Hoja "RESUMEN": 4 graficos nativos, SIN celdas de texto (las celdas con
#     string romperian sharedStrings al inyectar la hoja en otro workbook).
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/build-chart-template.ps1

$ErrorActionPreference = "Stop"

function RGBv([int]$r, [int]$g, [int]$b) { return $r + ($g * 256) + ($b * 65536) }

# Paleta corporativa sobria
$NAVY    = RGBv 47 84 150     # 2F5496
$AZURE   = RGBv 91 155 213    # 5B9BD5
$GREEN   = RGBv 30 132 73     # 1E8449
$TEAL    = RGBv 38 132 124    # 26847C
$AMBER   = RGBv 255 192 0     # FFC000
$ORANGE  = RGBv 237 125 49    # ED7D31
$GRAYTXT = RGBv 64 64 64
$GRIDGRY = RGBv 217 217 217
$BORDER  = RGBv 191 191 191

$palette = @($NAVY, $AZURE, $TEAL, $AMBER, $ORANGE, (RGBv 165 165 165))

$outPath = Join-Path (Get-Location) "templates\dashboard_chart_template.xlsx"
if (Test-Path $outPath) { Remove-Item $outPath -Force -Confirm:$false }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

try {
  $wb = $excel.Workbooks.Add()
  while ($wb.Worksheets.Count -gt 1) { $wb.Worksheets.Item($wb.Worksheets.Count).Delete() }

  # ── Dashboard_Data con datos de muestra ─────────────────────────────────────
  $data = $wb.Worksheets.Item(1)
  $data.Name = "Dashboard_Data"
  $headers = @("Provider","TotalNetCLP","SharePercent","QuotedItems","ComparableItems","CoveragePercent","DifferenceVsBestCLP","DifferenceVsBestPercent","IsBestOffer","IsMostExpensive","NeedsReview","WarningCount","Recommendation","RiskLevel","Score")
  for ($i = 0; $i -lt $headers.Count; $i++) { $data.Cells.Item(1, $i + 1).Value2 = $headers[$i] }
  # Muestra: 3 proveedores ordenados ascendente
  $sample = @(
    @("Proveedor A", 564405, 23.8, 2, 2, 100, 0,      0,    "TRUE",  "FALSE", "FALSE", 0, "Mejor oferta", "Bajo", 96),
    @("Proveedor B", 621000, 26.2, 2, 2, 100, 56595,  10.0, "FALSE", "FALSE", "FALSE", 1, "Comparable",   "Bajo", 84),
    @("Proveedor C", 1182980, 50.0, 2, 2, 100, 618575, 109.6,"FALSE", "TRUE",  "TRUE",  2, "Revisar",      "Alto", 52)
  )
  for ($r = 0; $r -lt $sample.Count; $r++) {
    for ($c = 0; $c -lt $sample[$r].Count; $c++) {
      $v = $sample[$r][$c]
      $cell = $data.Cells.Item($r + 2, $c + 1)
      if ($v -is [string]) { $cell.Value2 = [string]$v } else { $cell.Value2 = [double]$v }
    }
  }

  # ── RESUMEN: solo graficos, sin texto en celdas ─────────────────────────────
  # IMPORTANTE: la hoja RESUMEN no debe tener celdas con valores ni estilos:
  # los indices de estilo (s="N") y sharedStrings del template no existen en el
  # workbook destino y provocarian reparacion al inyectar la hoja.
  $resumen = $wb.Worksheets.Add([System.Reflection.Missing]::Value, $data)
  $resumen.Name = "RESUMEN"
  $resumen.Tab.Color = $NAVY
  try { $excel.ActiveWindow.DisplayGridlines = $false } catch { }

  function New-StyledChart($sheet, [double]$left, [double]$top, [double]$width, [double]$height, [int]$chartType, [int]$styleId) {
    $obj = $sheet.ChartObjects().Add($left, $top, $width, $height)
    $chart = $obj.Chart
    $chart.ChartType = $chartType
    try { $chart.ChartStyle = $styleId } catch { }
    $chart.ChartArea.RoundedCorners = $true
    $chart.ChartArea.Format.Fill.ForeColor.RGB = RGBv 255 255 255
    $chart.ChartArea.Format.Line.ForeColor.RGB = $BORDER
    $chart.ChartArea.Format.Line.Weight = 0.75
    $chart.ChartArea.Font.Size = 9
    $chart.ChartArea.Font.Color = $GRAYTXT
    return $chart
  }

  function Set-Title($chart, $text) {
    $chart.HasTitle = $true
    $chart.ChartTitle.Text = $text
    $chart.ChartTitle.Font.Size = 12
    $chart.ChartTitle.Font.Bold = $true
    $chart.ChartTitle.Font.Color = RGBv 31 56 100
  }

  function Add-MainSeries($chart, $valuesRef, $nameRef) {
    $s = $chart.SeriesCollection().NewSeries()
    $s.Values  = "=Dashboard_Data!" + $valuesRef
    $s.XValues = '=Dashboard_Data!$A$2:$A$7'
    $s.Name    = "=Dashboard_Data!" + $nameRef
    return $s
  }

  # 1) Ranking de total neto (barra horizontal) ────────────────────────────────
  $c1 = New-StyledChart $resumen 10 10 470 250 57 215   # 57 = xlBarClustered
  $s1 = Add-MainSeries $c1 '$B$2:$B$7' '$B$1'
  Set-Title $c1 "Ranking de total neto por proveedor (CLP)"
  $c1.HasLegend = $false
  $s1.HasDataLabels = $true
  $s1.DataLabels().NumberFormat = '"$" #,##0'
  $s1.DataLabels().Font.Size = 9
  $c1.Axes(1).ReversePlotOrder = $true            # mejor oferta arriba
  $c1.Axes(1).TickLabels.Font.Size = 9
  $c1.Axes(2).TickLabels.NumberFormat = '"$" #,##0'
  $c1.Axes(2).TickLabels.Font.Size = 8
  $c1.Axes(2).HasMajorGridlines = $true
  $c1.Axes(2).MajorGridlines.Format.Line.ForeColor.RGB = $GRIDGRY
  $c1.ChartGroups(1).GapWidth = 70
  for ($p = 1; $p -le 6; $p++) {
    try {
      if ($p -eq 1) { $s1.Points($p).Format.Fill.ForeColor.RGB = $GREEN }
      else          { $s1.Points($p).Format.Fill.ForeColor.RGB = $NAVY }
    } catch { }
  }

  # 2) Distribucion del gasto (donut) ──────────────────────────────────────────
  $c2 = New-StyledChart $resumen 490 10 330 250 -4120 259  # xlDoughnut
  $s2 = Add-MainSeries $c2 '$B$2:$B$7' '$B$1'
  Set-Title $c2 "Distribucion del gasto evaluado"
  $c2.HasLegend = $true
  $c2.Legend.Position = -4107                      # bottom
  $c2.Legend.Font.Size = 9
  $c2.ChartGroups(1).DoughnutHoleSize = 62
  $s2.HasDataLabels = $true
  $s2.DataLabels().ShowPercentage = $true
  $s2.DataLabels().ShowValue = $false
  $s2.DataLabels().NumberFormat = '0.0%'
  $s2.DataLabels().Font.Size = 9
  $s2.DataLabels().Font.Bold = $true
  $s2.DataLabels().Font.Color = RGBv 255 255 255
  for ($p = 1; $p -le 6; $p++) {
    try { $s2.Points($p).Format.Fill.ForeColor.RGB = $palette[$p - 1] } catch { }
  }

  # 3) Score ejecutivo (columnas) ───────────────────────────────────────────────
  $c3 = New-StyledChart $resumen 10 270 470 240 51 208   # 51 = xlColumnClustered
  $s3 = Add-MainSeries $c3 '$O$2:$O$7' '$O$1'
  Set-Title $c3 "Score ejecutivo por proveedor (0 a 100)"
  $c3.HasLegend = $false
  $s3.HasDataLabels = $true
  $s3.DataLabels().NumberFormat = '0'
  $s3.DataLabels().Font.Size = 9
  $c3.Axes(2).MinimumScale = 0
  $c3.Axes(2).MaximumScale = 100
  $c3.Axes(2).MajorUnit = 25
  $c3.Axes(2).TickLabels.Font.Size = 8
  $c3.Axes(2).HasMajorGridlines = $true
  $c3.Axes(2).MajorGridlines.Format.Line.ForeColor.RGB = $GRIDGRY
  $c3.Axes(1).TickLabels.Font.Size = 9
  $c3.ChartGroups(1).GapWidth = 90
  for ($p = 1; $p -le 6; $p++) {
    try { $s3.Points($p).Format.Fill.ForeColor.RGB = $TEAL } catch { }
  }

  # 4) Items cotizados por proveedor (columnas) ────────────────────────────────
  $c4 = New-StyledChart $resumen 490 270 330 240 51 208
  $s4 = Add-MainSeries $c4 '$D$2:$D$7' '$D$1'
  Set-Title $c4 "Items cotizados por proveedor"
  $c4.HasLegend = $false
  $s4.HasDataLabels = $true
  $s4.DataLabels().NumberFormat = '0'
  $s4.DataLabels().Font.Size = 9
  $c4.Axes(2).TickLabels.Font.Size = 8
  $c4.Axes(2).HasMajorGridlines = $true
  $c4.Axes(2).MajorGridlines.Format.Line.ForeColor.RGB = $GRIDGRY
  $c4.Axes(1).TickLabels.Font.Size = 9
  $c4.ChartGroups(1).GapWidth = 90
  for ($p = 1; $p -le 6; $p++) {
    try { $s4.Points($p).Format.Fill.ForeColor.RGB = $AZURE } catch { }
  }

  $wb.SaveAs($outPath, 51)   # 51 = xlOpenXMLWorkbook
  $wb.Close($false)
  Write-Output "Template generado: $outPath"
}
finally {
  $excel.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel)
}
