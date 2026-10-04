#!/usr/bin/env bash
#
# Muestrea RAM (RSS) y CPU de los procesos que casan con un patrón.
# Pensado para la app de escritorio: la webview, el proceso Tauri y el sidecar
# suelen compartir "phoson" en su línea de comandos.
#
# Uso:
#   scripts/perf-sample.sh [segundos] [patrón] [intervalo]
#
# Ejemplos:
#   scripts/perf-sample.sh 30                 # 30s, patrón "phoson"
#   scripts/perf-sample.sh 20 phoson-bridge   # solo el sidecar
#
# Salida: una línea por muestra + un resumen (RSS pico, CPU media/total).
# No requiere dependencias.

set -uo pipefail

DURATION="${1:-30}"
PATTERN="${2:-phoson}"
INTERVAL="${3:-1}"
HZ="$(getconf CLK_TCK 2>/dev/null || echo 100)"

if ! command -v pgrep >/dev/null 2>&1; then
  echo "Falta 'pgrep' (procps). Instálalo para usar este script." >&2
  exit 1
fi

pids() { pgrep -f "$PATTERN" 2>/dev/null || true; }

rss_kb() { awk '/VmRSS/{print $2}' "/proc/$1/status" 2>/dev/null || echo 0; }
cpu_ticks() { awk '{print ($14 + $15)}' "/proc/$1/stat" 2>/dev/null || echo 0; }

sum_rss=0
sum_ticks=0
prev_ticks=0
peak_rss=0
samples=0
total_cpu_pct=0

echo "Muestreando '$PATTERN' cada ${INTERVAL}s durante ${DURATION}s (CLK_TCK=${HZ})"
printf '%s\n' "t(s)  procs   RSS(MB)   CPU(%)"

t=0
while [ "$t" -lt "$DURATION" ]; do
  sum_rss=0
  sum_ticks=0
  n=0
  for pid in $(pids); do
    r="$(rss_kb "$pid")"; [ -n "$r" ] || r=0
    c="$(cpu_ticks "$pid")"; [ -n "$c" ] || c=0
    sum_rss=$((sum_rss + r))
    sum_ticks=$((sum_ticks + c))
    n=$((n + 1))
  done

  rss_mb=$((sum_rss / 1024))
  [ "$rss_mb" -gt "$peak_rss" ] && peak_rss=$rss_mb

  # %CPU respecto a la muestra anterior (varios cores pueden sumar >100%).
  cpu_pct=0
  if [ "$samples" -gt 0 ]; then
    delta=$((sum_ticks - prev_ticks))
    cpu_pct=$(( delta * 100 / HZ / INTERVAL ))
    [ "$cpu_pct" -lt 0 ] && cpu_pct=0
    total_cpu_pct=$((total_cpu_pct + cpu_pct))
  fi
  prev_ticks=$sum_ticks
  samples=$((samples + 1))

  printf '%-5s %-7s %-9s %s\n' "$t" "$n" "$rss_mb" "$cpu_pct"
  t=$((t + INTERVAL))
  sleep "$INTERVAL"
done

echo
echo "── Resumen ─────────────────────────────"
echo "Muestras:        $samples"
echo "RSS pico:        ${peak_rss} MB"
if [ "$samples" -gt 1 ]; then
  echo "CPU media:       $((total_cpu_pct / (samples - 1))) %"
fi
echo "Patrón:          '$PATTERN'"
