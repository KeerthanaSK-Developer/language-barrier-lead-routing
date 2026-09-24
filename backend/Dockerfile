FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# faster-whisper model cache (mount a volume in compose to keep downloads)
ENV HF_HOME=/root/.cache/huggingface
ENV WHISPER_MODEL_SIZE=medium
ENV WHISPER_DEVICE=cpu
ENV WHISPER_COMPUTE_TYPE=int8

EXPOSE 8000

# Railway sets PORT dynamically, use shell form to expand it
CMD sh -c 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}'
