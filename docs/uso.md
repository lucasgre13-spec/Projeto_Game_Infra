# Controles e comandos

O resultado depende da configuração, das dependências e das falhas presentes. Consulte o diagnóstico antes e depois de mudar uma configuração para distinguir causa e sintoma. Não use comandos reais de FortiOS ou AWS neste terminal: somente a sintaxe listada por `help` é reconhecida.

## Formulários

**Construir** cria um elemento por vez; o identificador precisa ser único. Nas redes, crie a unidade antes dos equipamentos e ligue portas existentes e livres. Selecione elementos pela topologia ou pela lista equivalente. Configuração de porta e configuração do equipamento são operações distintas.

Na AWS, referências selecionam recursos já criados. Listas de várias referências aceitam Ctrl/⌘ para seleção múltipla. Nas coleções de rotas, regras, pools e registros, **Adicionar linha** e **Remover linha** editam a coleção; aplicar a configuração efetiva a alteração. A ordem das políticas de firewall determina a primeira regra aplicável.

Em **Operação e incidentes**, demanda e capacidade afetam a disponibilidade; backups precisam ser criados antes da restauração. Reiniciar uma instância trata sua falha; indisponibilidade de zona exige dependências saudáveis em outra zona. O controle de retorno da zona pertence à simulação, não representa uma operação que a aplicação possa executar na AWS.

Use Tab/Shift+Tab para percorrer controles, Enter/Espaço para acionar botões e setas para escolhas. Escape fecha o catálogo. O foco retorna ao botão Construir após fechar o catálogo. Campos inválidos exibem erro e preservam o ambiente anterior.

## Terminal de redes

Os valores entre `<...>` são marcadores de sintaxe; substitua-os conforme sua investigação, sem digitar os sinais. IDs são os identificadores criados no laboratório.

```text
help
show interfaces
show config
show routes
ping <IPv4|equipamento|internet>
traceroute <destino>
nslookup <nome>
dhcp
set address <IPv4/prefixo> [gateway] [dns]
set dhcp <on|off>
set port <porta> <access|trunk> <VLAN|VLANs separadas por vírgula>
set link <enlace> <up|down>
set device <up|down>
```

As consultas não corrigem o ambiente. O equipamento escolhido no campo Contexto determina a origem do diagnóstico e da configuração. Configurações avançadas como VPN, políticas, pools e registros também estão nos formulários; não existe console FortiOS irrestrito.

## Terminal AWS

```text
help
list
show <id>
diagnose
logs
create <tipo> <id> <JSON de configuração>
update <id> <JSON de campos>
delete <id>
monitor on|off
demand <quantidade>
scale <id> <capacidade>
incident instance|zone <alvo>
recover <incidente>
backup <recurso>
restore <backup>
```

`create` e `update` recebem um objeto JSON, com aspas duplas nos nomes dos campos. O catálogo dos formulários mostra os campos e referências disponíveis. `recover` reinicia uma instância afetada por um incidente; uma zona indisponível precisa ser contornada. `backup` exige EC2, RDS ou S3 disponível; `restore` usa o identificador da cópia existente. Recursos removidos podem deixar dependências indisponíveis: o diagnóstico mostra o efeito sem reconstruí-las automaticamente.

Os tipos suportados são `iam`, `vpc`, `subnet`, `igw`, `nat`, `routeTable`, `securityGroup`, `ec2`, `alb`, `rds`, `s3`, `dns` e `vpn`. Não há chamadas à AWS nem necessidade de credenciais. Use apenas informações fictícias de estudo.
