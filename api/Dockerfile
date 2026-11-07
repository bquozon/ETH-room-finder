# The stats API with its packages and code baked in: if a build ever fails, the running container is untouched.
FROM python:3.12-alpine
WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt
COPY . api/
