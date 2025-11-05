# Como Coletar Logs de Instalação

Se a instalação do EXA Shield travar ou falhar, siga estas etapas para coletar os logs necessários para o diagnóstico.

1.  **Exclua o Log Antigo:**
    Antes de executar a instalação novamente, exclua o arquivo de log antigo para garantir que estamos analisando os dados mais recentes. No seu terminal, execute:
    ```bash
    rm setup-gcp.log
    ```

2.  **Execute o Script de Instalação:**
    Inicie o processo de instalação como de costume:
    ```bash
    node setup-gcp.js
    ```
    Siga as instruções na tela. Se o processo travar ou apresentar um erro, continue para a próxima etapa.

3.  **Colete o Arquivo de Log:**
    O script terá gerado um novo arquivo `setup-gcp.log` no mesmo diretório. Este arquivo contém informações detalhadas sobre cada etapa do processo de instalação.

4.  **Envie o Log para Análise:**
    Por favor, envie o conteúdo completo do arquivo `setup-gcp.log` para que possamos analisar a causa do problema.
