#!/bin/bash
set -e

# 設定變數
IMAGE_REPO="${IMAGE_REPO:-hub.docker.com}"
IMAGE_NAME="k8s-ops-web"
VERSION="${1:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-k8s-ops-web-builder}"

if ! docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
  docker buildx create --name "${BUILDER}" --driver docker-container --bootstrap >/dev/null
fi

AVAILABLE_PLATFORMS=""
while IFS= read -r line; do
  trimmed_line="${line#"${line%%[![:space:]]*}"}"
  case "${trimmed_line}" in
    "Platforms:"*)
      AVAILABLE_PLATFORMS="${trimmed_line#Platforms: }"
      AVAILABLE_PLATFORMS="${AVAILABLE_PLATFORMS//[[:space:]]/}"
      break
      ;;
  esac
done < <(docker buildx inspect "${BUILDER}" --bootstrap)

if [ -z "${AVAILABLE_PLATFORMS}" ]; then
  echo "Could not determine supported platforms for builder ${BUILDER}" >&2
  exit 1
fi

IFS=',' read -r -a TARGET_PLATFORMS <<< "${PLATFORMS}"
for platform in "${TARGET_PLATFORMS[@]}"; do
  if [[ ",${AVAILABLE_PLATFORMS}," != *",${platform},"* ]]; then
    echo "Builder ${BUILDER} does not support ${platform}. Available platforms: ${AVAILABLE_PLATFORMS}" >&2
    exit 1
  fi
done

# 建立標籤參數
TAGS=(--tag "${IMAGE_REPO}/${IMAGE_NAME}:${VERSION}")
if [ "${VERSION}" != "latest" ]; then
  TAGS+=(--tag "${IMAGE_REPO}/${IMAGE_NAME}:latest")
fi

echo "Building ${IMAGE_REPO}/${IMAGE_NAME}:${VERSION} for platforms: ${PLATFORMS} with ${BUILDER} ..."
docker buildx build \
  --builder "${BUILDER}" \
  --platform "${PLATFORMS}" \
  "${TAGS[@]}" \
  --push \
  .

echo "Image pushed: ${IMAGE_REPO}/${IMAGE_NAME}:${VERSION}"
