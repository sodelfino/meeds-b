# Instalação — Meeds B

Leva dois minutos, e é uma vez só. Depois disso ele se atualiza sozinho.

## 1. Tenha o Tampermonkey

É uma extensão do navegador. Instale pela loja do seu navegador (Chrome, Edge ou
Firefox) e siga para o passo 2.

> **Usa Edge?** Faça mais um ajuste, uma vez só: em **Configurações › Sistema e
> desempenho**, procure *"Nunca colocar estes sites em suspensão"* e acrescente
> `doctor.calltechsaude.com.br`. O Edge coloca abas de fundo para dormir de
> fábrica, e **uma aba dormindo não consulta a fila** — o alarme fica mudo sem
> avisar. O script detecta e conta depois que aconteceu, mas o certo é não deixar
> acontecer.

## 2. Instale o script

Abra este endereço com o Tampermonkey ligado. Ele mostra a tela de instalação:

https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.user.js

Clique em **Instalar**.

## 3. Abra o Meeds Doctor

Entre em `doctor.calltechsaude.com.br` como sempre. Um botão 🔔 aparece no canto
inferior direito. É só isso — ele já está funcionando.

- **Clique** no botão para ligar e desligar o alarme.
- **Clique com o botão direito** para escolher o som e o volume.

## 4. Autorize o aviso do sistema (recomendado)

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
preferências: ligado, som e volume.

**Ele funciona no iPad?**
O alarme na tela sim. A notificação do sistema, não: o Safari não a oferece fora
de aplicativo instalado. A tela do script diz isso quando é o caso, em vez de
oferecer uma opção que não faria nada.

**Preciso reinstalar quando sair versão nova?**
Não. O Tampermonkey verifica sozinho e atualiza.

**Como desinstalo?**
No painel do Tampermonkey, remova "Meeds B — Alarme de fila".
