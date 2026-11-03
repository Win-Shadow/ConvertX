FROM oven/bun:1.4.4-slim AS base
WORKDIR /app
COPY package.json bun.lock /app/
RUN bun install --frozen-lockfile
COPY . .

RUN bun run build:bin

# Speech-to-text for transcripts/subtitles. Built separately so the release image stays free of compilers.
FROM debian:testing-slim AS whisper
ARG WHISPER_VERSION=v1.9.5
ARG WHISPER_MODEL=small
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggml-org/whisper.cpp /src \
  && cmake -S /src -B /src/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build /src/build -j --target whisper-cli \
  && mkdir -p /opt/whisper && cp /src/build/bin/whisper-cli /opt/whisper/ \
  && curl -fL -o /opt/whisper/ggml-${WHISPER_MODEL}.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${WHISPER_MODEL}.bin

FROM debian:testing-slim AS release
LABEL org.opencontainers.image.source="https://github.com/C4illin/ConvertX"
WORKDIR /app

# install additional dependencies 
ENV PIPX_HOME=/opt/pipx
ENV PIPX_BIN_DIR=/usr/local/bin

RUN apt-get update && apt-get install -y \
  assimp-utils \
  ca-certificates \
  calibre \
  curl \
  dasel \
  dcraw \
  djvulibre-bin \
  dvisvgm \
  ffmpeg \
  ghostscript \
  gosu \
  graphicsmagick \
  imagemagick-7.q16 \
  img2pdf \
  inkscape \
  latexmk \
  libheif-examples \
  libimage-exiftool-perl \
  libjxl-tools \
  libreoffice \
  libva2 \
  libvips-tools \
  libemail-address-perl \
  libemail-outlook-message-perl \
  lmodern \
  mupdf-tools \
  pandoc \
  poppler-utils \
  potrace \
  python3-numpy \
  python3-tinycss2 \
  resvg \
  texlive \
  texlive-fonts-recommended \
  texlive-latex-extra \
  texlive-latex-recommended \
  texlive-xetex \
  zip \
  python3 \
  python3-pip \
  pipx \
  --no-install-recommends \
  && pipx install "markitdown[all]" \
  && rm -rf /var/lib/apt/lists/*

# OCR for scans and photos; separate layer so the big install above stays cached
RUN apt-get update && apt-get install -y --no-install-recommends \
  libgomp1 \
  ocrmypdf \
  tesseract-ocr \
  tesseract-ocr-eng \
  tesseract-ocr-spa \
  && rm -rf /var/lib/apt/lists/*

COPY --from=whisper /opt/whisper /opt/whisper
RUN ln -s /opt/whisper/whisper-cli /usr/local/bin/whisper-cli

# Remove when patch is released
RUN pipx runpip markitdown install --upgrade --no-cache-dir "Brotli>=1.2.1" "brotlicffi>=1.2.1.0"

RUN groupadd -g 1000 convertx && \
  useradd -u 1000 -g convertx -d /home/convertx -m -s /bin/bash convertx

# Install VTracer binary
RUN ARCH=$(uname -m) && \
  if [ "$ARCH" = "aarch64" ]; then \
  VTRACER_ASSET="vtracer-aarch64-unknown-linux-musl.tar.gz"; \
  else \
  VTRACER_ASSET="vtracer-x86_64-unknown-linux-musl.tar.gz"; \
  fi && \
  curl -L -o /tmp/vtracer.tar.gz "https://github.com/visioncortex/vtracer/releases/download/0.6.4/${VTRACER_ASSET}" && \
  tar -xzf /tmp/vtracer.tar.gz -C /tmp/ && \
  mv /tmp/vtracer /usr/local/bin/vtracer && \
  chmod +x /usr/local/bin/vtracer && \
  rm /tmp/vtracer.tar.gz

COPY --from=base /app/public/ /app/public/
COPY --from=base /app/dist/convertx /app/convertx

# COPY . .
RUN mkdir data

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000/tcp
# used for calibre
ENV QTWEBENGINE_CHROMIUM_FLAGS="--no-sandbox"
ENV NODE_ENV=production
ENTRYPOINT [ "/entrypoint.sh" ]
CMD [ "/app/convertx" ]

# test stage that includes Bun for running tests if needed
FROM release AS test
COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

# default target remains release
FROM release
