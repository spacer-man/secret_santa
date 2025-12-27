FROM python:3.13.8-bookworm


WORKDIR /app


COPY requirements.txt ./
RUN pip install -r requirements.txt;
COPY logging.yaml logging.yaml
COPY labels /labels

COPY src .


ENTRYPOINT python main.py
