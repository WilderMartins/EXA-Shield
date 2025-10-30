# EXA Shield: Detector de Ameaças Internas com IA

## 1. Objetivo do Projeto

O **EXA Shield** é uma aplicação de cibersegurança projetada para atuar como uma ferramenta de *Insider Threat Detection* (Detecção de Ameaças Internas) para organizações que utilizam o Google Workspace. O objetivo principal é analisar proativamente as comunicações internas e atividades de arquivos, incluindo logs em tempo real (Google Chat), dados arquivados (Google Vault) e logs de atividade de arquivos (Google Drive), para identificar riscos potenciais antes que se tornem incidentes de segurança graves.

A aplicação utiliza o poder da IA generativa (Google Gemini) para analisar logs e identificar padrões e anomalias associadas a:

-   **Vazamento de Dados:** Exposição acidental ou maliciosa de informações sensíveis (senhas, chaves de API, dados confidenciais, compartilhamento indevido de arquivos).
-   **Riscos de Segurança:** Comportamentos que violam políticas de segurança (compartilhamento de links suspeitos, práticas de senha inadequadas, transferência de propriedade de arquivos para externos).
-   **Ameaças Internas Deliberadas:** Expressões de frustração, intenção de prejudicar a empresa ou vazar informações.
-   **Análise de Sentimento e Retenção:** Identificação de insatisfação de funcionários, moral baixo e sinais de que um colaborador pode estar planejando deixar a organização (risco de perda/churn), o que pode preceder ações de risco.

O público-alvo são administradores de segurança, equipes de TI e executivos que precisam de visibilidade sobre os riscos internos da organização.

---

## 2. Status Atual do Projeto (Funcionalidades Implementadas)

A aplicação está em um estágio de **protótipo funcional com sistema de autenticação e integração de múltiplas fontes de dados do Google Workspace**. A interface do usuário e a lógica de análise principal estão implementadas, conectando-se a APIs reais para autenticação e parcialmente para busca de dados.

### 2.1. Interface e Componentes

-   **Sistema de Autenticação:**
    -   **Página de Login:** A aplicação agora requer autenticação. Uma nova página de login serve como ponto de entrada, oferecendo login via Google Workspace ou SSO com JumpCloud.
    -   **Gerenciamento de Sessão:** A sessão do usuário é persistida, e as informações do usuário logado são exibidas na barra lateral. Um botão de "Sair" (Logout) foi adicionado para encerrar a sessão de forma segura.

-   **Painel Principal (Dashboard):**
    -   Página inicial com uma visão geral do status de segurança.
    -   Botão "Verificar Agora" para iniciar uma análise sob demanda dos logs das fontes conectadas.
    -   Exibe alertas em tempo real, categorizados por severidade e tipo de ameaça, com um resumo estatístico da última verificação.

-   **Página de Configurações:**
    -   **Autenticação (SSO):** A seção de Logon Único foi atualizada para uma implementação completa do fluxo OIDC (OpenID Connect) com PKCE para JumpCloud, substituindo o login simulado. Os administradores podem configurar o Client ID e a aplicação irá guiar o usuário através do processo de autenticação real do JumpCloud.
    -   **Integrações de Dados:**
        -   Permite conectar contas Google via **OAuth 2.0** para autorizar a leitura de logs do Google Chat, Google Vault e Google Drive. A interface exibe o status da conexão e os detalhes do usuário para cada serviço.
        -   Um campo de entrada para o usuário especificar qual espaço do Google Chat deve ser monitorado.
    -   **API de Inteligência Artificial:** Permite selecionar o modelo do Google Gemini (`gemini-2.5-flash` ou `gemini-2.5-pro`).
    -   **Categorias de Ameaças:** Permite habilitar ou desabilitar os tipos de ameaças que a IA deve monitorar.
    -   **Notificações (AWS SES):** Permite configurar e habilitar o envio de notificações de alertas por e-mail via AWS.

-   **Navegação e Novas Páginas:**
    -   Uma barra lateral persistente permite a navegação entre as páginas: Painel Principal, Alertas, Relatórios, **Inteligência** e Configurações.
    -   **NOVO - Página de Inteligência de Ameaças:** Uma nova seção que busca (simuladamente) os últimos relatórios de ameaças de fontes externas e utiliza a IA do Gemini para fornecer um resumo executivo e recomendações práticas.
    -   **Página de Relatórios:** Um dashboard analítico que visualiza o histórico de alertas, com KPIs e gráficos de distribuição por severidade e categoria.
    -   **Página de Alertas:** Exibe uma lista paginada e filtrável de todos os alertas históricos. Os usuários podem filtrar por severidade, categoria da ameaça e intervalo de datas. Cada alerta é expansível para mostrar detalhes do log original.

### 2.2. Lógica e Backend (Frontend-driven)

-   **Análise com IA:**
    -   Utiliza a API `@google/genai` com um prompt dinâmico construído com base nas configurações do usuário.
    -   A IA é instruída a retornar uma resposta em formato JSON, que é parseada e renderizada na UI.
    -   **Notificações (Simulado):** A lógica verifica se há alertas de alta severidade e simula o envio de uma notificação por e-mail para o administrador configurado.

-   **Fonte de Dados:**
    -   **Google Workspace (Real/Simulado):** Utiliza logs simulados para garantir a presença de ameaças para demonstração. A função para buscar dados reais da API do Google Chat está implementada.
    -   **Google Vault (Simulado):** Utiliza dados simulados para representar os logs arquivados.
    -   **Google Drive (API Real):** Conecta-se diretamente à **API de Atividade do Google Drive** para buscar e analisar eventos reais, como compartilhamento de arquivos e alterações de propriedade.

-   **Gerenciamento de Estado e Persistência:**
    -   O estado da sessão do usuário é gerenciado pelo `AuthContext` e persistido no `localStorage`.
    -   As configurações da aplicação são gerenciadas pelo `SettingsContext` e também salvas no `localStorage`.
    -   O histórico de todos os alertas gerados é salvo no `localStorage` do navegador, garantindo que os dados para as páginas de Alertas e Relatórios persistam entre as sessões.

---

## 3. Arquitetura e Tecnologias

-   **Frontend:** React 19 com TypeScript.
-   **Autenticação:**
    -   **Identidade do Usuário:** Google Identity Services (GSI) para login na aplicação. Suporte a SSO com JumpCloud via OIDC com PKCE.
    -   **Autorização de API:** Google Identity Services (GSI) para OAuth 2.0 (Token-based) para acesso às APIs do Google.
-   **Estilização:** Tailwind CSS.
-   **API de IA:** `@google/genai` (Google Gemini API).
-   **APIs de Dados:** Google Chat API, Google Vault API, Google Drive Activity API.
-   **Estrutura do Código:** Uma aplicação de página única (SPA) com gerenciamento de estado via `React Context` (`AuthContext`, `SettingsContext`, `AlertsContext`).
-   **Ambiente de Execução:** Navegador web, utilizando um `importmap` para gerenciar as dependências.

---

## 4. Configuração para Desenvolvedores

### 4.1. Configuração do Google Cloud (Obrigatório)
Para executar a aplicação e testar as integrações, você **precisa criar um projeto no Google Cloud Platform**.

1.  Vá para o [Google Cloud Console](https://console.cloud.google.com/).
2.  Crie um novo projeto.
3.  No menu, vá para "APIs e Serviços" > "Biblioteca" e ative: **Google Chat API**, **Google Vault API**, **Google Drive API**, e a **Google Drive Activity API**.
4.  Vá para "APIs e Serviços" > "Tela de permissão OAuth". Configure a tela de consentimento (selecione "Externo" e adicione seu e-mail como usuário de teste).
5.  **Importante:** Adicione os escopos necessários: `https://www.googleapis.com/auth/chat.messages.readonly`, `https://www.googleapis.com/auth/ediscovery.readonly`, `https://www.googleapis.com/auth/drive.readonly`, `https://www.googleapis.com/auth/drive.activity.readonly`, `https://www.googleapis.com/auth/gmail.readonly`.
6.  Vá para "APIs e Serviços" > "Credenciais". Crie uma nova credencial "ID do cliente OAuth".
7.  Escolha "Aplicativo da Web".
8.  Em "Origens JavaScript autorizadas", adicione o URL da aplicação (ex: `http://localhost:3000` ou o URL do seu ambiente de desenvolvimento).
9.  Copie o **"ID do cliente"** gerado.
10. Cole esse ID na constante `GOOGLE_CLIENT_ID` no topo do arquivo `index.tsx`.

### 4.2. Configuração do JumpCloud (Opcional)
Para testar o login com JumpCloud:

1.  Acesse seu Painel de Administrador do JumpCloud.
2.  Navegue até "User Authentication" > "SSO".
3.  Clique no botão `(+)` para adicionar uma nova aplicação e escolha **"Custom OIDC App"**.
4.  Dê um nome para a aplicação (ex: "EXA Shield").
5.  Na aba de configuração do SSO, em **"Redirect URIs"**, adicione a URL onde você está executando o EXA Shield (ex: `http://localhost:3000` ou o URL do seu ambiente).
6.  Salve a aplicação.
7.  Após salvar, copie o **"Client ID"**.
8.  Na aplicação EXA Shield, vá para a página de Configurações, configure o SSO do JumpCloud e cole o Client ID no campo correspondente.

---

## 5. Próximos Passos e Desenvolvimento Futuro

1.  **Implementação de Backend para Agendador e Notificações:**
    -   Criar um serviço de backend (ex: Google Cloud Functions) que execute a análise com base no cronograma definido.
    -   Substituir a simulação de notificação pela integração real com a API do AWS SES no backend.

2.  **Evoluir a Persistência de Dados:**
    -   Migrar o armazenamento de alertas e configurações do `localStorage` para um banco de dados (ex: Firestore) para suportar múltiplos usuários e escalabilidade.

3.  **Gerenciamento de Token Robusto:**
    -   Implementar um mecanismo para lidar com a expiração de tokens de acesso às APIs do Google (refresh tokens), preferencialmente no backend.