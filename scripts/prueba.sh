#!/usr/bin/env bash
# Hace N peticiones al balanceador y muestra qué nodo respondió, el código HTTP y el tiempo.
# Uso:  ./scripts/prueba.sh             (10 peticiones a /health)
#       ./scripts/prueba.sh 20 /api/info
N="${1:-10}"
RUTA="${2:-/health}"
URL="${URL:-http://localhost:8089}"

printf "%-4s %-10s %-7s %-5s %s\n" "#" "Hora" "Nodo" "HTTP" "ms"
ok=0; total_ms=0; max_ms=0
declare -A por_nodo
for i in $(seq 1 "$N"); do
  salida=$(curl -s -m 15 -w $'\n%{http_code} %{time_total}' "$URL$RUTA")
  meta=$(printf "%s" "$salida" | tail -n 1)
  cuerpo=$(printf "%s" "$salida" | sed '$d')
  http=${meta%% *}
  segs=${meta##* }
  ms=$(awk -v s="$segs" 'BEGIN { printf "%d", s * 1000 + 0.5 }')
  nodo=$(printf "%s" "$cuerpo" | sed -n 's/.*"nodo":"\([^"]*\)".*/\1/p')
  nodo=${nodo:--}
  printf "%-4s %-10s %-7s %-5s %s\n" "$i" "$(date +%H:%M:%S)" "$nodo" "$http" "$ms"
  [ "$http" = "200" ] && ok=$((ok + 1))
  total_ms=$((total_ms + ms)); [ "$ms" -gt "$max_ms" ] && max_ms=$ms
  por_nodo[$nodo]=$(( ${por_nodo[$nodo]:-0} + 1 ))
done
echo
echo "Resumen por nodo:"
for n in $(printf "%s\n" "${!por_nodo[@]}" | sort); do echo "  $n: ${por_nodo[$n]} peticiones"; done
echo "Respuestas 200: $ok de $N   |   Tiempo promedio: $((total_ms / N)) ms   |   Máximo: $max_ms ms"
