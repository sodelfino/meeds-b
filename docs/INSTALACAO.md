# Instalação — Meeds B

Leva dois minutos, e é uma vez só. Depois disso ele se atualiza sozinho.

As duas versões abaixo têm o **mesmo código**, byte a byte — só o cabeçalho
difere. Use a do Tampermonkey no computador ou Android; a do Safari, só no
iPad, iPhone ou Mac.

---

## No computador (Windows, Mac, Linux) ou no Android

### 1. Tenha o Tampermonkey

É uma extensão do navegador. Instale pela loja do seu navegador (Chrome, Edge
ou Firefox) e siga para o passo 2.

> **Usa Edge?** Faça mais um ajuste, uma vez só: em **Configurações › Sistema e
> desempenho**, procure *"Nunca colocar estes sites em suspensão"* e acrescente
> `doctor.calltechsaude.com.br`. O Edge coloca abas de fundo para dormir de
> fábrica, e **uma aba dormindo não consulta a fila** — o alarme fica mudo sem
> avisar. O script detecta e conta depois que aconteceu, mas o certo é não deixar
> acontecer.

### 2. Instale o script

Abra este endereço com o Tampermonkey ligado. Ele mostra a tela de instalação:

https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.user.js

Clique em **Instalar**.

### 3. Abra o Meeds Doctor

Entre em `doctor.calltechsaude.com.br` como sempre. Um botão 🔔 aparece no canto
inferior direito, com uma ⚙️ pequena ao lado. É só isso — ele já está
funcionando.

- **Clique** no 🔔 para trocar a intensidade: 🔔 completo → 🔉 discreto →
  🔕 silencioso → 🔔 de novo.
- **Clique** na ⚙️ ao lado para abrir o painel: intensidade, som, volume e a
  janela de aviso. (Clique com o botão direito ou shift+clique no próprio 🔔
  também abrem o mesmo painel, se preferir.)

---

## No iPad, no iPhone ou no Mac com Safari

Não existe Tampermonkey para o Safari, mas existe um app equivalente e
gratuito: **Userscripts**, na App Store. Há uma versão do Meeds B feita para
ele — mesmo programa, cabeçalho diferente.

### 1. Instalar o app

Na App Store, procure por **Userscripts** (ícone `</>` laranja). É gratuito.

### 2. Ligar a extensão — é aqui que quase todo mundo trava

**Instalar o app não liga a extensão.** Enquanto ela estiver desligada, nada
acontece no Safari e nenhum script instala.

1. **Ajustes** (o app cinza de engrenagem) → **Aplicativos** → **Safari** →
   **Extensões**. *(Em iOS/iPadOS mais antigo: Ajustes → Safari → Extensões.)*
2. Toque em **Userscripts** e ligue a chave.
3. Ainda nessa tela, toque em **Todos os sites** e escolha **Permitir**.

> Sem o passo 3 a extensão fica ligada mas sem permissão, e o resultado é o
> mesmo: nada acontece.

### 3. Instalar o script

No Safari, abra:

https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.safari.user.js

A tela vai encher de código — é isso mesmo, não é erro. Toque no **ícone de
extensões** na barra de endereço → **Userscripts**, e confirme a instalação
oferecida.

> **Se a tela só mostrar código, sem oferecer instalação:** baixe o arquivo
> pelo [release mais recente](https://github.com/sodelfino/meeds-b/releases/latest)
> e mova para a pasta do Userscripts pelo app Arquivos.

### 4. Abra o Meeds Doctor

Mesma tela, mesmo botão 🔔 com a ⚙️ ao lado — ver o passo 3 da seção do
computador, acima. Funciona igual.

---

## Autorize o aviso do sistema (recomendado, no computador)

É o que faz o alarme chegar quando você está no Memed ou em outra janela — que é
quando ele mais importa.

Clique com o botão direito no 🔔 e, se aparecer **"Ativar avisos do sistema"**,
clique. O navegador pergunta uma vez.

> **Se nada acontecer ao clicar:** alguns navegadores (o Edge por padrão)
> silenciam esse pedido e só piscam um **ícone de sino na barra de endereço**.
> Clique nele e escolha permitir.

> **Se disser que está bloqueado:** clique no **cadeado** na barra de endereço,
> ao lado do endereço do site, e libere as notificações.

## Como saber que está funcionando

Com um paciente na fila, o título da aba passa a mostrar `(1)` antes do nome, e o
ícone da aba vira um número vermelho. Com a aba de fundo, você recebe a
notificação do sistema.

## Perguntas

**Ele guarda dados dos meus pacientes?**
Não. Nenhum nome, CPF ou queixa é lido, gravado ou enviado. O aviso fala em
quantidade — "2 aguardando" — e nada mais. Em disco ficam só as suas
preferências: intensidade, som, volume e janela de aviso.

**Ele funciona no iPad e no iPhone?**
Sim, pela versão do Safari (ver "No iPad, no iPhone ou no Mac com Safari",
acima) — mesmo alarme, mesmas três intensidades. Duas coisas mudam: a
notificação do sistema não aparece (o Safari do iOS não a oferece para
páginas web, com ou sem extensão) e a "janela de aviso" também não — o iOS
abre uma aba por cima do site, não uma janela, e só a partir de um gesto.
Som e a faixa/moldura na tela continuam funcionando iguais; a tela do painel
não oferece essas duas opções quando detecta o iPad, em vez de mostrar algo
que não vai funcionar.

**Preciso reinstalar quando sair versão nova?**
Não. Tampermonkey e Userscripts verificam sozinhos e atualizam.

**Como desinstalo?**
No painel do Tampermonkey (ou, no Userscripts, na lista de scripts do app),
remova "Meeds B — Alarme de fila".
