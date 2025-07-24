provider "local" {}

resource "null_resource" "manual_servers" {
  provisioner "local-exec" {
    command = "echo 'Für kingdom-gpt-hosting werden die Server manuell bereitgestellt. Die IPs sind: 167.235.183.61 (ex101), 136.243.78.14 (gpu01).' "
  }
}

output "ex101_ip" {
  value = "167.235.183.61"
}
output "gpu01_ip" {
  value = "136.243.78.14"
}
