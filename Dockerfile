FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8000 \
    SUPPLIER_CSV=/app/data/supplier_risk_dataset.csv REPORTS_DIR=/app/data/reports
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN useradd --uid 10001 --create-home gauge
COPY --chown=gauge:gauge app ./app
COPY --chown=gauge:gauge web ./web
COPY --chown=gauge:gauge contracts ./contracts
COPY --chown=gauge:gauge data/supplier_risk_dataset.csv ./data/supplier_risk_dataset.csv
RUN mkdir -p /app/data/reports && chown gauge:gauge /app/data/reports
USER gauge
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,os;urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('PORT','8000')+'/healthz',timeout=4)"
CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --proxy-headers --forwarded-allow-ips='*'"]
