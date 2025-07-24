# kingdom-gpt-hosting

**Produktivsystem für dein KI-Dashboard und GPU-Backend**  
Alle Konfigurationsdaten und Komponenten sind ECHT und sofort einsetzbar.

## Features (Auszug)

- User-Login & Multi-User-Management (inkl. Admin)
- Modell-Upload/Registrierung und Steuerung im Dashboard
- GPU-Server (Ollama, Bild/Audio/Video) steuerbar
- Nextcloud-Integration (Dateiablage, Vorschau, Sharing)
- Digistore24-Lizenzverwaltung
- API-Management
- Responsive, modernes Design (Next.js, Tailwind, Material-UI)
- Healthchecks, Log- und Systemmonitoring

## Quickstart (Installations-Guide)

1. **Repo klonen und Umgebungsvariablen setzen**
    ```bash
    git clone git@github.com:kingdom-hosting/kingdom-gpt-hosting.git
    cd kingdom-gpt-hosting
    cp .env .env.local # falls benötigt
    ```

2. **Terraform Infrastruktur (lokal, falls Cloud-Provisionierung)**
    ```bash
    cd terraform
    terraform init
    terraform apply
    ```

3. **Ansible Playbook auf beiden Servern ausführen**
    ```bash
    cd ../ansible
    ansible-playbook -i inventories/production site.yml
    ```

4. **Dashboard im Browser öffnen**
    - https://dashboard.kingdom-hosting.de
    - Admin-User einrichten, Digistore24-Key im Admin-Bereich nachtragen

## Support

Für alle produktiven Zugangsdaten siehe `.env`.  
Bei Problemen: [docs/SUPPORT.md](docs/SUPPORT.md)
