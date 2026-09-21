FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# Railway sets PORT dynamically, use shell form to expand it
CMD sh -c 'uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}'
