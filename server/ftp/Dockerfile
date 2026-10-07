# docker-server — serveur FTP (vsftpd). Construit automatiquement par le tableau de bord.
FROM alpine:3.22
RUN apk add --no-cache vsftpd
COPY vsftpd.conf /etc/vsftpd/vsftpd.conf
COPY entrypoint.sh /entrypoint.sh
RUN sed -i 's/\r$//' /entrypoint.sh /etc/vsftpd/vsftpd.conf && chmod +x /entrypoint.sh
EXPOSE 21
ENTRYPOINT ["/entrypoint.sh"]
