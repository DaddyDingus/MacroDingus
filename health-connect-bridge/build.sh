#!/usr/bin/env bash
set -euo pipefail

bridge_dir=$(cd "$(dirname "$0")" && pwd)
source_dir="$bridge_dir/.build/source"
upstream_commit="650c4cc84972700200ed74497894c30994321eba"
java_home="/home/daddydingus/.local/share/jdks/temurin-17"
android_home="/home/daddydingus/Android/Sdk"

signing_key="$bridge_dir/../android/macrotrack-release.jks"
signing_password_file="$bridge_dir/../android/.signing-password"
if [[ ! -f "$signing_key" || ! -f "$signing_password_file" ]]; then
  echo "Missing permanent MacroDaddy signing files." >&2
  exit 1
fi

mkdir -p "$bridge_dir/.build"
if [[ ! -d "$source_dir/.git" ]]; then
  git clone https://github.com/mcnaveen/health-connect-webhook "$source_dir"
fi
git -C "$source_dir" fetch --tags origin
git -C "$source_dir" reset --hard "$upstream_commit"
git -C "$source_dir" clean -fdx
test "$(git -C "$source_dir" rev-parse HEAD)" = "$upstream_commit"
git -C "$source_dir" apply --unidiff-zero "$bridge_dir/macrodaddy-v1.9.14.patch"

cp "$signing_key" "$source_dir/app/release.jks"
signing_password=$(tr -d '\r\n' < "$signing_password_file")
(
  cd "$source_dir"
  JAVA_HOME="$java_home" \
  ANDROID_HOME="$android_home" \
  KEYSTORE_PASSWORD="$signing_password" \
  KEY_ALIAS="macrotrack" \
  KEY_PASSWORD="$signing_password" \
  ./gradlew --no-daemon clean assembleFossRelease
)
cp "$source_dir/app/build/outputs/apk/foss/release/app-foss-release.apk" "$bridge_dir/health-connect-webhook.apk"
"$android_home/build-tools/35.0.0/apksigner" verify --verbose "$bridge_dir/health-connect-webhook.apk"
sha256sum "$bridge_dir/health-connect-webhook.apk"
