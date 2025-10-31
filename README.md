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

## 🚀 Guia de Instalação Rápida (5 Minutos)

Instalar o EXA Shield agora é um processo simples e quase totalmente automatizado.

### Pré-requisitos

1.  **Conta Google Workspace:** Você precisa ser um administrador.
2.  **Node.js:** O ambiente que executa a aplicação. [Instale a versão LTS (recomendada) aqui](https://nodejs.org/).
3.  **Google Cloud SDK:** A ferramenta de linha de comando para o Google Cloud. [Siga as instruções de instalação aqui](https://cloud.google.com/sdk/docs/install).

---

### Passo 1: Baixe o Código

Clone o repositório do projeto para a sua máquina. Se você não tem o `git` instalado, pode baixar o código como um arquivo ZIP.

```bash
git clone https://github.com/seu-usuario/exa-shield.git
cd exa-shield
```

### Passo 2: Instale as Dependências

Este comando único instala tudo o que o frontend e o backend precisam para funcionar.

```bash
npm install
```

### Passo 3: Configure o Ambiente Google Cloud (O jeito fácil!)

Execute o assistente de configuração. Ele vai te guiar pelo processo de login, criação de projeto no Google Cloud e geração de todas as chaves de API necessárias, criando o arquivo `.env` para você.

```bash
node setup-gcp.js
```

Siga as instruções que aparecerão no seu terminal. O script fará todo o trabalho pesado.

### Passo 4: Ligue os Motores!

Agora, inicie a aplicação. Este comando vai ligar o servidor do backend e o servidor do frontend ao mesmo tempo.

```bash
npm run dev
```

Você verá mensagens indicando que ambos os servidores estão rodando.

Abra seu navegador e acesse: **http://localhost:3000**

**Pronto!** O EXA Shield está funcionando na sua máquina. Siga os passos na tela para conectar sua conta e começar a proteger seu ambiente.

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

Quando estiver pronto para usar o EXA Shield de forma contínua, o processo é similar, mas com alguns passos adicionais:

*   **Domínio e HTTPS:** Implante a aplicação em um servidor (ex: Google Cloud Run, Vercel, etc.) e configure um domínio com um certificado SSL/TLS (HTTPS).
*   **Atualize os URIs de Redirecionamento:** No seu projeto no [console do Google Cloud](https://console.cloud.google.com/), vá para `APIs e Serviços > Credenciais`. Edite seu "ID do cliente OAuth" e adicione o novo URI de produção (ex: `https://exashield.suaempresa.com/api/auth/google/callback`) à lista de URIs autorizados.
*   **Atualize o `.env`:** Altere a variável `REDIRECT_URI` no seu arquivo `.env` de produção para o novo domínio.
*   **Automatize a Análise:** Para monitoramento contínuo, configure um "Cron Job" (tarefa agendada) no seu servidor para chamar o endpoint `POST /api/run-analysis` periodicamente (ex: a cada 30 minutos). Serviços como o Google Cloud Scheduler são perfeitos para isso.
