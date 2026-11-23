# Hace N peticiones al balanceador y muestra que nodo respondio, el codigo HTTP y el tiempo.
# Uso:  .\scripts\prueba.ps1            (10 peticiones a /health)
#       .\scripts\prueba.ps1 -N 20 -Ruta /api/info
param(
    [int]$N = 10,
    [string]$Ruta = "/health",
    [string]$Url = "http://localhost:8089"
)

$filas = for ($i = 1; $i -le $N; $i++) {
    $salida = curl.exe -s -m 15 -w "`n%{http_code} %{time_total}" "$Url$Ruta"
    $lineas = $salida -split "`n"
    $meta = ($lineas[-1]).Trim() -split " "
    $cuerpo = ($lineas[0..($lineas.Length - 2)] -join "`n")
    $nodo = "-"
    try { $nodo = ($cuerpo | ConvertFrom-Json).nodo } catch {}
    [pscustomobject]@{
        "#"     = $i
        Hora    = (Get-Date -Format "HH:mm:ss")
        Nodo    = $nodo
        HTTP    = $meta[0]
        "ms"    = [math]::Round([double]::Parse($meta[1], [cultureinfo]::InvariantCulture) * 1000)
    }
}

$filas | Format-Table -AutoSize
"Resumen por nodo:"
$filas | Group-Object Nodo | Sort-Object Name | ForEach-Object { "  {0}: {1} peticiones" -f $_.Name, $_.Count }
$ok = ($filas | Where-Object { $_.HTTP -eq "200" }).Count
$prom = [math]::Round(($filas | Measure-Object ms -Average).Average)
$max = ($filas | Measure-Object ms -Maximum).Maximum
"Respuestas 200: $ok de $N   |   Tiempo promedio: $prom ms   |   Maximo: $max ms"
