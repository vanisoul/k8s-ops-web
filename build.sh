#!/bin/bash
set -e

# 設定變數
IMAGE_REPO="${IMAGE_REPO:-hub.docker.com}"
IMAGE_NAME="k8s-ops-web"
VERSION="${1:-latest}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"

echo "Building ${IMAGE_REPO}/${IMAGE_NAME}:${VERSION} for platforms: ${PLATFORMS} ..."

# 建立 tags 參數
TAGS_CMD="-t ${IMAGE_REPO}/${IMAGE_NAME}:${VERSION}"
TAGS="${IMAGE_REPO}/${IMAGE_NAME}:${VERSION}"
if [ "${VERSION}" != "latest" ]; then
  TAGS_CMD="${TAGS_CMD} -t ${IMAGE_REPO}/${IMAGE_NAME}:latest"
  TAGS="${TAGS} ${IMAGE_REPO}/${IMAGE_NAME}:latest"
fi

docker build \
  --platform "${PLATFORMS}" \
  ${TAGS_CMD} \
  .

docker push ${TAGS}

echo "Done! Image pushed: ${DOCKER_USER}/${IMAGE_NAME}:${VERSION}"
