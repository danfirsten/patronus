#!/usr/bin/env bash
# Patronus 30-second pitch video: step 2 of 2 (edit and encode).
#
# Takes the stills from capture.mjs (build/shots/*.png), gives each a slow
# push-in, cross-fades them, draws a lower-third band, burns in the captions
# (build/captions.ass, written below) and adds a generated ambient pad.
# Output: patronus-30s.mp4, 1920x1080, 30 fps, H.264 + AAC, exactly 30.0 s.
#
#   node capture.mjs && ./capture.sh
#
# Shot timing and captions are the single source of truth here; script.md
# documents them for humans. Every number must match DESIGN.md section 12.
set -euo pipefail
cd "$(dirname "$0")"

SHOTS=build/shots
OUT=${OUT:-patronus-30s.mp4}
FPS=30
XF=0.25                     # cross-fade length (s)
FONT="Helvetica Neue"       # macOS system font; libass falls back elsewhere

# name  duration(s)   (sum 31.5 - 6 x 0.25 cross-fades = 30.0 s)
NAMES=(01-hook 02-history 03-alarm 04-record 05-lights 06-forecast 07-global)
DURS=(4.0 4.0 6.0 4.0 4.0 4.5 5.0)

# Captions: start,end,main line,sub line (times on the final 30 s timeline).
CAPTIONS=(
  "0.15|3.75|When the reservoirs drain, hydropower countries go dark.|Patronus turns NASA water data into a warning months ahead."
  "3.75|7.50|Lake Kariba, Zambia and Zimbabwe: 2.89% usable storage, Dec 2024.|Satellite lake levels since 1992: G-REALM (NASA/USDA)"
  "7.50|13.25|Our El Niño alarm fired in Jul 2023: 5 months before the official cut.|Fair backtest, only data known at the time. 8 months before load-shedding."
  "13.25|17.00|Not cherry-picked: every El Niño season since 1995.|3 hits, 2 misses, 2 false alarms. We show the misses."
  "17.00|20.75|From space: Zambia's cities 36% darker in Sep-Oct 2024.|NASA Black Marble night lights vs Feb 2023 (Lusaka -52%)"
  "20.75|25.00|2027: about a 1-in-3 chance (36%) Kariba falls below 10% usable.|Forecast inputs: G-REALM, GRACE-FO, NASA POWER, GPCP, GEOS-S2S El Niño outlook"
  "25.00|29.85|Worldwide: 392 GW of hydropower sits in basins losing water.|GRACE/GRACE-FO 2002-2026, Sen's slope, Mann-Kendall + FDR  ·  patronus-blackout-watch.aui-svi.workers.dev"
)

for n in "${NAMES[@]}"; do [[ -f $SHOTS/$n.png ]] || { echo "missing $SHOTS/$n.png: run node capture.mjs first" >&2; exit 1; }; done
mkdir -p build

# --- captions (ASS) ---------------------------------------------------------
ts() { python3 -c "import sys;t=float(sys.argv[1]);print(f'{int(t//3600)}:{int(t%3600//60):02d}:{t%60:05.2f}')" "$1"; }
{
  cat <<EOF
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,$FONT,50,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,1,96,96,92,1
Style: Sub,$FONT,30,&H00D6C38D,&H00D6C38D,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,1,96,96,44,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
EOF
  for c in "${CAPTIONS[@]}"; do
    IFS='|' read -r s e main sub <<<"$c"
    echo "Dialogue: 0,$(ts "$s"),$(ts "$e"),Main,,0,0,0,,{\\fad(200,150)}$main"
    echo "Dialogue: 0,$(ts "$s"),$(ts "$e"),Sub,,0,0,0,,{\\fad(200,150)}$sub"
  done
} > build/captions.ass

# --- video graph ------------------------------------------------------------
inputs=(); graph=""; i=0
for n in "${NAMES[@]}"; do
  d=${DURS[$i]}; frames=$(python3 -c "print(round($d*$FPS))")
  inputs+=(-loop 1 -framerate $FPS -t "$d" -i "$SHOTS/$n.png")
  # Fit to 16:9 on the page colour, upscale to 4K for smooth sub-pixel zoom, push in 4%.
  graph+="[$i:v]scale=3840:2160:force_original_aspect_ratio=decrease:flags=lanczos,pad=3840:2160:(ow-iw)/2:(oh-ih)/2:color=0xEEF2F3,setsar=1,"
  graph+="zoompan=z='1+0.04*on/$frames':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=$FPS,format=yuv420p[v$i];"
  i=$((i+1))
done
# Chain cross-fades.
prev="v0"; offset=0
for ((k=1; k<${#NAMES[@]}; k++)); do
  offset=$(python3 -c "print(round($offset + ${DURS[$((k-1))]} - $XF, 3))")
  graph+="[$prev][v$k]xfade=transition=fade:duration=$XF:offset=$offset[x$k];"
  prev="x$k"
done
# Lower-third band + captions + fade from/to the deep colour.
graph+="[$prev]drawbox=x=0:y=ih-200:w=iw:h=200:color=0x0B2A3C@0.90:t=fill,subtitles=build/captions.ass,"
graph+="fade=t=in:st=0:d=0.4:color=0x0B2A3C,fade=t=out:st=29.5:d=0.5:color=0x0B2A3C,trim=duration=30[vout];"

# --- music: generated ambient pad (no third-party audio) --------------------
# Slow A-minor-ish drone: sines at 110/164.8/220/261.6 Hz with gentle tremolo.
n=${#NAMES[@]}
graph+="aevalsrc='0.10*sin(2*PI*110*t)*(0.75+0.25*sin(2*PI*0.13*t))+0.06*sin(2*PI*164.81*t)*(0.7+0.3*sin(2*PI*0.09*t+1))+0.05*sin(2*PI*220*t)*(0.7+0.3*sin(2*PI*0.07*t+2))+0.035*sin(2*PI*261.63*t)*(0.6+0.4*sin(2*PI*0.05*t+3))':s=48000:d=30,"
graph+="lowpass=f=1800,aecho=0.8:0.7:120|240:0.3|0.2,afade=t=in:d=1.5,afade=t=out:st=27.5:d=2.5,volume=0.9,aformat=channel_layouts=stereo[aout]"

ffmpeg -hide_banner -loglevel warning -stats -y "${inputs[@]}" -filter_complex "$graph" \
  -map "[vout]" -map "[aout]" -r $FPS -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -profile:v high \
  -c:a aac -b:a 160k -t 30 -movflags +faststart "$OUT"

ffprobe -v error -show_entries format=duration,size:stream=codec_name,width,height,r_frame_rate -of compact "$OUT"
