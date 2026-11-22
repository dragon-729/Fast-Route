# Build context = repository root:  docker build -f backend/Dockerfile -t resqroute-api .
FROM gcc:13 AS cbuild
WORKDIR /src
COPY c_engine/ .
RUN make

FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir fastapi uvicorn "pydantic>=2.6"
COPY backend/app ./app
COPY --from=cbuild /src/build/resq_engine /app/bin/resq_engine
ENV ENGINE_BIN=/app/bin/resq_engine DB_PATH=/data/resqroute.db PORT=8000
RUN useradd -m app && mkdir -p /data && chown app /data
USER app
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request,os;urllib.request.urlopen('http://localhost:'+os.environ.get('PORT','8000')+'/api/health')"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
