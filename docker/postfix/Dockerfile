FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    postfix \
    opendkim \
    opendkim-tools \
    inotify-tools \
    rsyslog \
    dnsutils \
    && rm -rf /var/lib/apt/lists/*

# Directories
RUN mkdir -p /etc/opendkim/keys /dkim-keys /var/run/opendkim \
    && chown opendkim:opendkim /var/run/opendkim /etc/opendkim/keys

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 25

ENTRYPOINT ["/entrypoint.sh"]
