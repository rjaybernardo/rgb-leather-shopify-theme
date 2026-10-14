#!/usr/bin/env bash
# Exports web-ready images from the RGB LeatherCrafts archive drive into store-content/images.
# Usage: store-content/build-images.sh [path-to-archive]
set -euo pipefail
SRC="${1:-/run/media/rjaybernardo/Transcend/01 RGB LeatherCrafts}"
OUT="$(cd "$(dirname "$0")" && pwd)/images"
BG='#F2ECE4'   # matches the theme's cream palette

# Cut-out PNG → square JPEG on cream with even padding
cutout() { [ -s "$2" ] && return 0; magick "$1" -background "$BG" -alpha remove -alpha off -fuzz 2% -trim +repage \
  -resize 1700x1700 -gravity center -extent 2048x2048 -strip -quality 84 -interlace JPEG "$2"; }
# Photo → max 2048px long edge
photo() { [ -s "$2" ] && return 0; magick -define jpeg:size=4096x4096 "$1" -auto-orient -resize '2048x2048>' -strip -quality 84 -interlace JPEG "$2"; }

P="$SRC/01 Products"; T="$P/Tari Case/Tari Case Collection"; W="$SRC/04 Marketing & Videos/Website Assets"
o="$OUT/products"

i=1; for n in 01 03 09 05 10 11 08 02; do cutout "$P/Catch Cock/No Background/CC-$n.png" "$o/catch-bag-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in 12 14 15 16 19 20; do cutout "$P/Catch Cock/No Background/CH-$n.png" "$o/catch-bag-foam-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in 01 03 04 13 15 02 10 16; do cutout "$P/Takera/No Background/TA-$n.png" "$o/takera-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in 08 09 04 06 07 01 02 03; do cutout "$P/Tari Case/Sheath No Background/SH-$n.png" "$o/tari-sheath-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in 000 002 004 006 013 010 015 019 008; do photo "$T/24 Capacity Basket Design/Web_24-Capacity/Final/Tari-Case-24-Capacity-$n.jpg" "$o/tari-case-basket-weave-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in P7081886 P7081907 P7081892 P7081855 P7081868 P7081874 P7081880 P7081901; do photo "$T/24 Caps Croc All Fiber Glass/$n.JPG" "$o/tari-case-croc-$(printf %02d $i).jpg"; i=$((i+1)); done
L="$T/Lanjean Tari-Case/Images From DSLR"
i=1; for n in P1012010 P1011995 P1012004 P1012016 P1012019 P1011980 P1012040; do photo "$L/$n.JPG" "$o/tari-case-square-strap-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in P1050465 P1050470 P1050462 P1050473 P1050476 P1050480; do photo "$P/Sharpener Case/Sharpener Leather Case/$n.JPG" "$o/sharpener-case-$(printf %02d $i).jpg"; i=$((i+1)); done
i=1; for n in P1012135 P1012136 P1012137 P1012138; do photo "$P/Arm Protector/Images/$n.JPG" "$o/arm-protector-$(printf %02d $i).jpg"; i=$((i+1)); done

# Brand
magick "$W/For RGB Site/RGB LeatherCrafts Logo01.png" -trim +repage -strip "$OUT/brand/rgb-leathercrafts-logo.png"
magick "$W/For RGB Site/RGB LeatherCrafts Logo01.png" -trim +repage -channel RGB -negate +channel -strip "$OUT/brand/rgb-leathercrafts-logo-light.png"
magick "$SRC/03 Branding/Website Favicon & Logo/fav.png" -resize 192x192 -strip "$OUT/brand/favicon.png"

# Site imagery (hero, about, story)
s="$OUT/site"; A="$W/About Page (Tatay Workshop)"
photo "$W/For RGB Site/RGB-LeatherCrafts.jpg" "$s/hero-hand-tooling.jpg"
photo "$W/For RGB Site/banner.jpg" "$s/workshop-bw.jpg"
photo "$A/about.jpg" "$s/workshop-portrait.jpg"
photo "$A/tatay.jpg" "$s/ricardo-bernardo-workshop.jpg"
photo "$A/tay1.jpg" "$s/workshop-stitching-01.jpg"
photo "$A/tay2.jpg" "$s/workshop-stitching-02.jpg"
photo "$P/Catch Cock/Catch Cock from LA Sorted for Web/For Web/Leather-Catch-Cock-02.jpg" "$s/catch-bag-in-use.jpg"
photo "$P/Catch Cock/Catch Cock from LA Sorted for Web/For Web/Leather-Catch-Cock-01.jpg" "$s/catch-bag-customer.jpg"
photo "$T/24 Capacity Basket Design/Web_24-Capacity/Final/Tari-Case-24-Capacity-001.jpg" "$s/tari-case-detail.jpg"
photo "$W/Web_RGB-Images/Leather-Crocodile-Design.jpg" "$s/leather-croc-texture.jpg"

# Custom builds (Tari Case 01 (Client Builds) + Tari Case Collection)
C="$P/Tari Case/Tari Case 01 (Client Builds)"; c="$OUT/custom"; mkdir -p "$c"
build() { local slug=$1 dir=$2; shift 2; local i=1; for n in "$@"; do photo "$dir/$n" "$c/$slug-$(printf %02d $i).jpg"; i=$((i+1)); done; }
build custom-6-capacity-floral "$C/Jim_Vill_Cor/Web_Jim-Vill-Cor_6-Capacity" Tari-Case-6-Capacity-00{2,3,4,6,8}.png Tari-Case-6-Capacity-01{0,2}.png Tari-Case-6-Capacity-001.png
build custom-36-capacity-combination-lock "$C/36_Capacity_Combination_Lock/Web_36-Capacity_Combination-Lock" Tari-Case-48-Capacity-Combination-Lock-0{01,02,03,04,06,08,10,13}.jpg
build custom-36-capacity-latch-lock "$C/36_Capacity_Latch_Lock/Web_36-Capacity_Latch-Lock" Tari-Case-48-Capacity-Latch-Lock-0{01,02,03,05,07}.jpg isoView.jpg inside.jpg lock.jpg
build custom-36-capacity-crest "$C/APO/Web_36-Capacity_APO" P1018{806,813,797,816,850,853,817,833}.jpg
build custom-48-capacity-shield-logo "$C/GPR/Web_48-Capacity_GPR" P1019{535,545,532,534,547,559,475,459}.jpg
build custom-48-capacity-lucky-box "$C/Lucky_Box/Web_48-Capacity_Lucky-Box-800x667" P1010{150,152,154,158,166,168,174}.png
build custom-36-capacity-old-type "$T/Raw_ORF_36-Capacity_Jake-Speed" P1018{495,501,513,519,525,531,477}.JPG
build portfolio-association-crest "$P/Tari Case/Tari Case PGA" 20170304_080440.jpg 20170304_080716.jpg 20170304_081032.jpg 20170303_103256.jpg
build portfolio-process "$T/Raw_Tatay" P1018980.JPG P1018990.JPG P1019000.JPG

# Catch bag, takera and sharpener builds + extra portfolio
CC="$P/Catch Cock/All Catch Cock Sold/ALL CATCH COCK/Catch_Cock/Catch-Cock_WEB_Final"; E="$P/Tari Case/Engr Tari Case Takera Sharpener Case"; CP="$SRC/02 Client Projects"
cb() { local slug=$1; shift; local i=1; for n in "$@"; do photo "$(find "$CC" -name "*Protector_$n.jpg" | head -1)" "$c/$slug-$(printf %02d $i).jpg"; i=$((i+1)); done; }
cb personalised-catch-bag Kinawi_Crown_Gamefarm Bobski_GameFarm Double_Basher GBros_Gamefarm RDG_Redwings Alcmon_Gamefarm Team_G_Forces Gladiator_Spartacus Krizalyn-Gamefarm Bulikis_Bulik_GF
cb portfolio-catch-bag Kinawi_Crown_Gamefarm RDG_Redwings Double_Basher Greenfields_Gamefarm Sure_Cutters JSM_Navigators Lakay_Bros Passion_Bloodline HawaiianStar Simply_Three Triple_R Kelsig_Farm
build leather-takera-tri-kolor "$P/Takera/Takera Tri Kolor" P10505{21,24,26,29,32,35,38,44}.JPG
build personalised-sharpener-case "$E" P10502{52,51,43,39,47,53}.JPG
build portfolio-rooster-case "$E" P10502{10,15,25,04}.JPG
build portfolio-ship-wheel-crest "$CP/Project 11262018 El Rafael/Images" P10506{40,45,52,60}.JPG
build portfolio-eagle-crest "$CP/Project 11292018 Agilahas" P10506{75,77,79,72}.JPG
build portfolio-fraternity-crest "$CP/Project 11162018 APO Ervin Basamot" P10506{05,11,15,19}.JPG

# Extra product photos and journal (blog) photos
x="$OUT/extra"; j="$OUT/journal"; mkdir -p "$x" "$j"
pick() { local slug=$1 dir=$2 out=$3; shift 3; local i=1 f; for n in "$@"; do
  f="$(find "$dir" -maxdepth 1 -name "$n" | head -1)"; [ -n "$f" ] || { echo "no match for $n in $dir" >&2; exit 1; }
  photo "$f" "$out/$slug-$(printf %02d $i).jpg"; i=$((i+1)); done; }
WU="$P/Catch Cock/All Catch Cock Sold/Catch Cock/Web_Uploaded_Final"; IG="$P/Catch Cock/Catch Cock Infographics"
pick catch-bag-detail "$WU" "$x" '*Details (1).png' '*Details (3).png' '*Details (5).png' '*Details (7).png' '*Actual-Use (1).png' '*Actual-Use (5).png'
pick catch-bag-feature "$IG" "$x" 'Infographics-02*' 'SAMPLE-SQUARE-1*' 'Leather-Catch-Cock-03*'
pick catch-bag-worn "$P/Catch Cock/CC with Foam" "$x" '00.*' '02.*'
pick catch-bag-foam-insert "$P/Catch Cock/Catch Cock Foam" "$x" 'IMG_20180102_142238*' 'IMG_20180102_142247*' 'IMG_20180102_142256*' 'IMG_20180102_163849*' 'IMG_20180102_163931*'
pick takera-client "$CP/Project 11222018 Takera" "$x" P1050574.JPG P1050577.JPG P1050579.JPG P1050582.JPG P1050586.JPG P1050584.JPG
pick tari-sheath-client "$CP/Project 11222018 Leather Tari Sheath" "$x" P1050562.JPG P1050564.JPG P1050567.JPG P1050572.JPG
RT="$T/Raw_Tatay"; CPR="$P/Catch Cock/All Catch Cock Sold/Catch Cock/New folder/Raw_Catch-Cock-Process-02042016"
pick journal-catch-bag-making "$RT" "$j" P1018978.JPG P1018982.JPG P1018986.JPG P1018994.JPG P1018998.JPG P1019000.JPG
pick journal-catch-bag-fitting "$CPR" "$j" 'P1010185*' 'P1010206*' 'P1010270*'
TN="$SRC/05 Materials & Suppliers/Leather from Tannery Pictures"; BN="$SRC/05 Materials & Suppliers/Binondo Materials"
pick journal-tannery "$TN" "$j" 20170105_145348.jpg 20170105_145406.jpg 20170105_145443.jpg 20170105_145505.jpg 20170105_145534.jpg 20170105_145549.jpg
pick journal-hardware "$BN" "$j" IMG_20171229_132500.jpg IMG_20171229_132543.jpg
EX="$SRC/04 Marketing & Videos/World Gamefowl Expo products"
pick journal-expo "$EX/Web_World-Gamefowl-Expo" "$j" '12473828*' '12493752*'
pick journal-expo-2016 "$EX/World GameFowl Expo" "$j" IMG_20160116_104440.jpg IMG_20160116_104451.jpg IMG_20160116_103748.jpg
pick journal-expo-2017 "$EX" "$j" 20170120_124300.jpg 20170120_131613.jpg
echo "done: $(find "$OUT" -type f | wc -l) files, $(du -sh "$OUT" | cut -f1)"
