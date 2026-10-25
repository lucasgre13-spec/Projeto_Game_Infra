# Nexo Lab

Laboratório educativo local para aprender construindo, diagnosticando e reparando redes empresariais e arquitetura AWS. São 31 missões: 14 de redes e 17 de nuvem. A dificuldade cresce do nível 1 ao 5; pré-requisitos impedem avançar sem comprovar o resultado da missão anterior.

## Iniciar e encerrar

Requer **Node.js 22 ou superior** no PATH e navegador atual com JavaScript e armazenamento local habilitados. Instale pelo [site oficial do Node.js](https://nodejs.org). Não requer conta AWS, licença FortiOS, credenciais, instalação de pacotes ou conexão externa durante o uso.

No Windows, abra `iniciar.cmd` dentro desta pasta. O inicializador usa a própria pasta, mesmo quando chamado de outro diretório. Alternativamente, abra um terminal nesta pasta:

```text
npm start
```

Abra [http://127.0.0.1:4173](http://127.0.0.1:4173). [http://localhost:4173](http://localhost:4173) também pode ser usado quando localhost resolve para IPv4. Escolha um endereço e mantenha-o para retomar o mesmo progresso. O servidor escuta somente em 127.0.0.1; não disponibiliza o laboratório na rede corporativa.

Mantenha o terminal aberto. Encerre com **Ctrl+C** (confirme o encerramento do lote se o Windows perguntar). Fechar somente a aba não encerra o servidor. Porta ocupada gera erro sem encerrar o processo existente: use o laboratório já aberto ou escolha outra porta com `iniciar.cmd 4174` ou `node server.mjs 4174`. Também é possível configurar a variável `PORT`; um argumento explícito tem preferência. Abra o endereço que o servidor imprimir. Outra porta terá outro progresso.

## Estudar

Escolha uma trilha, leia o resultado esperado e use **Construir** para criar unidades, equipamentos, enlaces ou recursos. A empresa começa vazia. Clique no mapa ou na lista abaixo dele para configurar cada elemento. Portas, referências, regras e dependências precisam ser coerentes para que os diagnósticos funcionem.

**Verificar resultado** avalia a infraestrutura atual. Criar um ícone ou clicar repetidamente não conclui a missão. Tentativas mal sucedidas e pistas preservam a configuração. As três pistas graduais orientam a investigação sem aplicar alterações nem preencher uma solução. O histórico de conclusão permanece mesmo se você provocar uma falha depois; a avaliação atual continua mostrando o estado real.

**Diagnóstico** e **Inspecionar** mostram observações calculadas. O **Terminal educativo** consulta e altera o mesmo ambiente dos formulários: selecione o equipamento na trilha de redes e digite `help`. Na trilha AWS, o contexto é o ambiente completo. Os comandos são simulados e não executam comandos no computador. Consulte [controles e comandos](docs/uso.md).

A opção **Reduzir movimento** desativa as pequenas animações de tráfego. Botões, campos, listas e abas podem ser usados por teclado; em telas estreitas, a jornada e a topologia têm rolagem própria.

## Retomar ou recomeçar

Configurações, conclusões, tentativas, pistas, missão ativa e preferência de movimento são salvas automaticamente no navegador. O histórico visual do terminal é temporário. O save usa `nexo-lab.save.v1` no armazenamento local da **origem** (protocolo, endereço e porta). `localhost` e `127.0.0.1`, perfis diferentes e outros navegadores mantêm saves separados. Não use modo privado para progresso durável.

Para recomeçar conscientemente, abra as ferramentas de desenvolvedor do navegador, vá a **Application/Aplicativo → Local Storage/Armazenamento local**, selecione somente o endereço do laboratório e remova somente a chave `nexo-lab.save.v1`; então recarregue. Isso apaga as duas campanhas dessa origem. Copie o valor da chave antes se desejar guardá-lo. Não limpe todos os dados do navegador. Parar o servidor ou recarregar a página não apaga o save.

Dados inválidos ou incompatíveis geram aviso e disponibilizam sessão vazia. Armazenamento bloqueado permite continuar na sessão, mas a tela avisa quando não consegue salvar. Não existe sincronização em nuvem nem backup automático fora do navegador.

## Limites

Esta é uma **simulação educativa**, com regras determinísticas e escopo reduzido. Não emula FortiOS integralmente, serviços AWS completos, tráfego real, credenciais, cobrança, latência, protocolos de produção ou uma certificação. VPN depende de redes, rotas, políticas e pares compatíveis no modelo. O armazenamento de objetos comprova bucket privado, identidade limitada e saúde da arquitetura; não simula transferência da aplicação para S3.

Os custos são **unidades didáticas por mês**, calculadas pelo laboratório, sem moeda nem correspondência com preços reais da AWS. Nenhum recurso AWS é criado. Operações de backup e restauração copiam configurações do modelo, não dados de produção. Entrada da aplicação via balanceador e saída para internet são verificadas separadamente: falhar a saída por NAT não derruba, por si só, o acesso privado do balanceador à aplicação.

## Verificar o projeto

Na pasta do projeto, execute `node --test tests/*.test.mjs` ou `npm test`. A suíte verifica modelos, persistência, progressão e integração. A jornada integrada começa vazia, alcança as 31 missões por ações públicas e exercita falhas e reparos; testes Node não substituem inspeção visual no navegador.
