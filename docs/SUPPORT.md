# Support & FAQ (kingdom-gpt-hosting)

**Dashboard nicht erreichbar:**  
- Prüfe SSL/TLS und Apache Proxy auf ex101.
- Healthcheck: `systemctl status dashboard`

**GPU-Modelle nicht sichtbar / Fehler 502:**  
- Prüfe auf gpu01: `systemctl status ollama`  
- Modelle ggf. manuell per `ollama pull <modell>` laden

**Nextcloud-Fehler:**  
- Log: `/opt/gpt/nextcloud/data/nextcloud.log`

**Digistore24:**  
- Webhook-Logs in `api-integrations/digistore24/webhook.log`

**Passwörter vergessen?**  
- Datenbank-Zugang siehe `.env`
