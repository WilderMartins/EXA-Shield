# 🛡️ EXA Shield: Seu Guardião Inteligente para o Google Workspace

**EXA Shield** é uma aplicação de segurança de ponta, projetada para ser os olhos e ouvidos do seu ambiente Google Workspace. Ele utiliza o poder da Inteligência Artificial do Google (Gemini 2.5 Pro) para detectar ameaças internas, como vazamento de dados, comportamento suspeito de usuários e atividades maliciosas, antes que se tornem um problema real.

Pense nele como um analista de segurança dedicado, trabalhando 24/7 para proteger seus dados mais críticos.

---

## ✨ Funcionalidades Incríveis

*   **👁️ Monitoramento Abrangente:** Fica de olho em atividades no Google Drive, Login, Chat e mais, para que nada passe despercebido.
*   **🧠 Análise com IA de Elite:** Usa o modelo Gemini 2.5 Pro para entender o *contexto* por trás dos logs, identificando riscos que seriam invisíveis para uma análise comum.
*   **🔔 Alertas Inteligentes e Diretos:** Em vez de logs confusos, você recebe alertas claros, classificados por severidade (Alta, Média, Baixa), com uma explicação do porquê aquilo é um risco.
*   **⚙️ Controle Total na Ponta dos Dedos:** Um painel de controle simples permite que você escolha o que monitorar e adicione palavras-chave personalizadas (como "confidencial", "projeto_secreto") para uma proteção sob medida.
*   **🔐 Segurança em Primeiro Lugar:** A conexão com sua conta Google Workspace usa o protocolo OAuth2, o padrão ouro da indústria. Suas credenciais nunca são vistas ou armazenadas pela aplicação.
*   **🚀 Verificação Imediata:** Precisa de uma análise agora? Um clique no botão "Verificar Agora" inicia uma varredura completa sob demanda.

---
## 🤔 Como Funciona? (A Mágica por Trás da Cortina)

1.  **Conexão Segura:** Você autoriza o EXA Shield a ler os logs de atividades do seu Google Workspace. É como dar uma chave de "apenas leitura" para um segurança.
2.  **Coleta de Dados:** A aplicação coleta os logs recentes dos serviços que você escolheu (Drive, Login, etc.).
3.  **Análise com IA:** Os logs são enviados para o cérebro da operação, o Gemini. A IA analisa os eventos em busca de padrões anômalos, uso de palavras-chave de risco e comportamentos que fogem do normal.
4.  **Geração de Alertas:** Se a IA detecta uma ameaça potencial, ela cria um alerta detalhado no seu dashboard, explicando o risco, mostrando o usuário envolvido e as evidências encontradas.
5.  **Ação Rápida:** Você, o administrador, visualiza o alerta e pode tomar as ações necessárias para mitigar o risco.

---

## 🚀 Guia de Instalação para Iniciantes (Passo a Passo)

Não se preocupe se você não é um expert em tecnologia. Siga estes passos com calma e você terá o EXA Shield funcionando!

### Parte 1: O Que Você Precisa Ter em Mãos

1.  **Conta Google Workspace:** Você deve ser um administrador.
2.  **Conta Google Cloud Platform (GCP):** Se não tiver, [crie uma gratuitamente aqui](https://cloud.google.com/).
3.  **Node.js:** É o ambiente que executa o "motor" da aplicação. [Instale a versão LTS (recomendada) aqui](https://nodejs.org/).

---
### Parte 2: A Aventura no Google Cloud (Configurando a Base)

Esta é a parte mais importante. Vamos criar a "identidade" da sua aplicação no Google.

#### 1. Crie um Novo Projeto

*   Acesse o [console do Google Cloud](https://console.cloud.google.com/).
*   No topo da página, clique no seletor de projetos (ao lado do logo "Google Cloud") e depois em **"NOVO PROJETO"**.
*   Dê um nome fácil de lembrar, como `EXA Shield App`, e clique em **"CRIAR"**.

#### 2. Ative as "Ferramentas" (APIs)

*   Com seu novo projeto selecionado, vá para o menu (☰) no canto superior esquerdo e clique em **`APIs e Serviços > Biblioteca`**.
*   Use a barra de busca para encontrar e **ATIVAR** cada uma das seguintes APIs, uma por uma:
    *   `Admin SDK API`
    *   `Google People API`
    *   `Generative Language API` (Esta é a API do Gemini)
    *   `Cloud Firestore API` (Este será nosso banco de dados)

#### 3. Prepare o "Armazenamento" (Firestore)

*   No menu (☰), desça até a seção `Bancos de dados` e clique em **`Firestore`**.
*   Clique em **"CRIAR BANCO DE DADOS"**.
*   Escolha o modo **Nativo**.
*   Escolha um local (ex: `southamerica-east1 (São Paulo)`) e clique em **"CRIAR BANCO DE DADOS"**.

#### 4. Crie as "Chaves de Acesso" (Credenciais)

Agora, vamos gerar as senhas que a nossa aplicação usará para se comunicar com o Google. **Guarde estas chaves em um local seguro!**

*   **a) Tela de Permissão (O que o usuário verá):**
    *   No menu (☰), vá para `APIs e Serviços > Tela de consentimento OAuth`.
    *   Selecione `Externo` e clique em **"CRIAR"**.
    *   Preencha os campos obrigatórios:
        *   **Nome do app:** `EXA Shield`
        *   **E-mail para suporte do usuário:** (seu e-mail)
        *   **Informações de contato do desenvolvedor:** (seu e-mail novamente)
    *   Clique em **"SALVAR E CONTINUAR"** nas próximas telas até voltar ao painel.
    *   Clique em **"Adicionar usuários"** e adicione seu próprio e-mail como um "Usuário de teste". Isso permite que você use a aplicação antes de publicá-la.

*   **b) Chave do "Portão Principal" (Credenciais OAuth 2.0):**
    *   Vá para `APIs e Serviços > Credenciais`.
    *   Clique em `+ CRIAR CREDENCIAIS` e selecione `ID do cliente OAuth`.
    *   **Tipo de aplicativo:** `Aplicativo da Web`.
    *   **Nome:** `EXA Shield Web Client`.
    *   Em `URIs de redirecionamento autorizados`, clique em `+ ADICIONAR URI` e cole exatamente isso: `http://localhost:3001/api/auth/google/callback`
    *   Clique em **"CRIAR"**. Uma janela aparecerá. **COPIE o `ID DO CLIENTE` e a `CHAVE SECRETA DO CLIENTE`.** Guarde-os em um bloco de notas por enquanto.

*   **c) Chave da "Sala de Inteligência" (Chave de API do Gemini):**
    *   Ainda em `Credenciais`, clique em `+ CRIAR CREDENCIAIS` e selecione `Chave de API`.
    *   Uma chave será gerada. **COPIE esta chave.**

---
### Parte 3: Configurando a Aplicação na Sua Máquina

#### 1. Baixe o Código

*   Baixe o código-fonte deste projeto como um arquivo ZIP e extraia-o em uma pasta de fácil acesso (ex: `C:\Projetos\exa-shield`).

#### 2. Instale as "Peças do Motor" (Dependências)

*   Abra o terminal do seu computador (no Windows, pode ser o "Prompt de Comando" ou "PowerShell").
*   Navegue até a pasta `backend` que está dentro do projeto. O comando é `cd`, por exemplo: `cd C:\Projetos\exa-shield\backend`
*   Execute o comando abaixo. Ele vai baixar e instalar tudo que o backend precisa.
    ```bash
    npm install
    ```

#### 3. Configure o "Painel de Controle Secreto" (Arquivo .env)

*   Dentro da pasta `backend`, crie um novo arquivo de texto e o nomeie exatamente como `.env` (sem nada antes do ponto).
*   Abra este arquivo e cole o conteúdo abaixo. Substitua os textos de exemplo pelas chaves que você copiou e guardou na Parte 2.

    ```env
    # Cole aqui as credenciais da Parte 2.4.b
    GOOGLE_CLIENT_ID=SEU_ID_DE_CLIENTE_AQUI.apps.googleusercontent.com
    GOOGLE_CLIENT_SECRET=SUA_CHAVE_SECRETA_AQUI

    # Cole aqui a chave da API da Parte 2.4.c
    API_KEY=SUA_CHAVE_DE_API_AQUI

    # Este valor deve ser exatamente o mesmo que você configurou no Google Cloud
    REDIRECT_URI=http://localhost:3001/api/auth/google/callback

    # Para segurança, invente duas frases longas e aleatórias aqui
    COOKIE_SECRET_KEY_1=frase-secreta-aleatoria-numero-um-muito-longa
    COOKIE_SECRET_KEY_2=frase-secreta-aleatoria-numero-dois-super-segura
    ```

---
### Parte 4: Ligar os Motores! 🚀

1.  No seu terminal, certifique-se que você ainda está na pasta `backend`.
2.  Execute o comando mágico:
    ```bash
    npm start
    ```
3.  Você deverá ver a mensagem: `Backend do EXA Shield rodando na porta 3001`.
4.  Abra seu navegador de internet e acesse: **http://localhost:3001**

**Parabéns!** O EXA Shield está rodando na sua máquina. Siga os passos na tela para conectar sua conta e começar a proteger seu ambiente!

---

## 📖 Como Usar a Ferramenta

1.  **Conexão Inicial:** Ao abrir a aplicação, clique para conectar sua conta Google Workspace. Você será levado a uma tela de permissão do Google. Aceite para continuar.
2.  **Dashboard:** Esta é a tela principal, onde todos os alertas de segurança aparecerão em tempo real.
3.  **Configurações:** No menu, acesse "Configurações" para:
    *   Habilitar ou desabilitar o monitoramento de cada serviço (Drive, Login, etc.).
    *   Adicionar ou remover palavras-chave de risco.
    *   Iniciar uma verificação manual a qualquer momento.

---
## 🔮 Levando para o Mundo Real (Deploy em Produção)

Quando estiver pronto para usar o EXA Shield de forma contínua e acessível por outros, siga estes passos:

*   **Domínio e HTTPS:** Implante a aplicação em um servidor (ex: Google Cloud Run, DigitalOcean, etc.) e configure um domínio com um certificado SSL/TLS (HTTPS). Isso é crucial para a segurança.
*   **Atualize o URI:** No painel do Google Cloud (`APIs e Serviços > Credenciais`), adicione o seu novo URI de produção (ex: `https://exashield.suaempresa.com/api/auth/google/callback`) à lista de URIs de redirecionamento autorizados.
*   **Atualize o `.env`:** Altere o `REDIRECT_URI` no seu arquivo `.env` de produção para o novo domínio.
*   **Automatize a Análise:** Para que o monitoramento seja contínuo, configure um "Cron Job" (uma tarefa agendada) no seu servidor para chamar o endpoint `POST /api/run-analysis` periodicamente (ex: a cada 30 minutos). Serviços como o Google Cloud Scheduler são perfeitos para isso.
