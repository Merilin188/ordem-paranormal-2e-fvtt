/**
 * Caixa de sussurro: o mestre manda a um ou mais jogadores uma pergunta (e,
 * se quiser, itens ofertados). Cada jogador recebe, no chat, uma caixa só dele
 * para responder em segredo; a resposta chega só ao mestre, que pode revelá-la
 * a todos. Itens ofertados podem ser aceitos e vão para a ficha do personagem.
 *
 * Toda mensagem nasce no cliente do mestre (ponte `comoMestre`): sussurro criado
 * pelo jogador aparece para o próprio jogador, e a caixa precisa mudar de estado
 * (respondida, item aceito) — só o autor/mestre consegue editar.
 */
import { SYSTEM_ID } from "../config.mjs";
import { comoMestre, registrarAcaoDeMestre } from "./socket.mjs";

const { DialogV2 } = foundry.applications.api;
const L = (k, d) => (d ? game.i18n.format(`OP2.Sussurro.${k}`, d) : game.i18n.localize(`OP2.Sussurro.${k}`));
const esc = (t) => foundry.utils.escapeHTML(String(t ?? ""));
const mestres = () => game.users.filter((u) => u.isGM).map((u) => u.id);
const quebras = (t) => esc(t).replace(/\n/g, "<br>");

/* -- conteúdo da caixa (refeito a cada mudança, a partir das flags) ------------ */

function htmlDaCaixa(f) {
  const itens = (f.itens ?? []).map((it) => {
    const aceito = (f.aceitos ?? []).includes(it.uuid);
    return `<li class="op2-sussurro__item${aceito ? " op2-sussurro__item--aceito" : ""}">
      <img src="${esc(it.img)}" alt=""><span>${esc(it.nome)}</span>
      ${aceito ? `<em><i class="fa-solid fa-check"></i> ${esc(L("Aceito"))}</em>`
        : `<button type="button" class="op2-botao op2-botao--pequeno" data-op2-sussurro-aceitar="${esc(it.uuid)}">${esc(L("Aceitar"))}</button>`}
    </li>`;
  }).join("");
  return `<div class="op2 op2-card op2-sussurro">
    <h3><i class="fa-solid fa-comment-dots"></i> ${esc(L("TituloCaixa", { nome: f.nomeAlvo }))}</h3>
    <p class="op2-sussurro__pergunta">${quebras(f.pergunta)}</p>
    ${itens ? `<p class="op2-sussurro__oferta">${esc(L("Ofertados"))}</p><ul class="op2-sussurro__itens">${itens}</ul>` : ""}
    ${f.respondida
      ? `<p class="op2-dica"><i class="fa-solid fa-check"></i> ${esc(L("RespostaEnviada"))}</p>`
      : `<div data-op2-sussurro-form></div>`}
  </div>`;
}

/* -- ações no cliente do mestre -------------------------------------------------- */

async function criarCaixa({ usuarioId, atorUuid, pergunta, itens }) {
  const usuario = game.users.get(usuarioId);
  if (!usuario) return null;
  const ator = atorUuid ? await fromUuid(atorUuid) : usuario.character;
  const flags = {
    tipo: "sussurro", caixa: true, usuarioId, atorUuid: ator?.uuid ?? "", nomeAlvo: ator?.name ?? usuario.name,
    pergunta, itens, aceitos: [], respondida: false,
  };
  return ChatMessage.create({
    content: htmlDaCaixa(flags),
    speaker: { alias: L("Mestre") },
    whisper: [usuarioId, ...mestres()],
    flags: { [SYSTEM_ID]: flags },
  });
}

async function atualizarCaixa(mensagem, mudancas) {
  const f = { ...(mensagem.flags?.[SYSTEM_ID] ?? {}), ...mudancas };
  await mensagem.update({ content: htmlDaCaixa(f), [`flags.${SYSTEM_ID}`]: f });
}

async function receberResposta({ mensagemId, texto }) {
  const caixa = game.messages.get(mensagemId);
  const f = caixa?.flags?.[SYSTEM_ID];
  if (!f?.caixa || f.respondida) return;
  await atualizarCaixa(caixa, { respondida: true });
  await ChatMessage.create({
    content: `<div class="op2 op2-card op2-sussurro op2-sussurro--resposta">
      <h3><i class="fa-solid fa-user-secret"></i> ${esc(L("Sussurra", { nome: f.nomeAlvo }))}</h3>
      <p class="op2-sussurro__pergunta"><small>${quebras(f.pergunta)}</small></p>
      <blockquote>${quebras(texto)}</blockquote>
      <div class="op2-sussurro__mestre" data-op2-gm><button type="button" class="op2-botao op2-botao--pequeno" data-op2-sussurro-revelar>
        <i class="fa-solid fa-eye"></i> ${esc(L("Revelar"))}</button></div>
    </div>`,
    speaker: { alias: f.nomeAlvo },
    whisper: mestres(),
    flags: { [SYSTEM_ID]: { tipo: "sussurro", resposta: true } },
  });
}

async function aceitarItem({ mensagemId, itemUuid }) {
  const caixa = game.messages.get(mensagemId);
  const f = caixa?.flags?.[SYSTEM_ID];
  if (!f?.caixa || (f.aceitos ?? []).includes(itemUuid)) return;
  const ator = f.atorUuid ? await fromUuid(f.atorUuid) : game.users.get(f.usuarioId)?.character;
  const fonte = await fromUuid(itemUuid);
  if (!ator || !fonte) return void ui.notifications.warn(L("SemDestino"));
  const dados = fonte.toObject();
  delete dados._id;
  await ator.createEmbeddedDocuments("Item", [dados]);
  await atualizarCaixa(caixa, { aceitos: [...(f.aceitos ?? []), itemUuid] });
  await ChatMessage.create({
    content: `<div class="op2 op2-card op2-sussurro"><p><i class="fa-solid fa-hand-holding"></i> ${esc(L("AceitouItem", { nome: ator.name, item: fonte.name }))}</p></div>`,
    speaker: { alias: L("Mestre") },
    whisper: mestres(),
    flags: { [SYSTEM_ID]: { tipo: "sussurro" } },
  });
}

/* -- API ------------------------------------------------------------------------ */

/**
 * Manda uma caixa para cada destino. `destinos`: [{ usuarioId, atorUuid? }].
 * `itens`: uuids de Item (do mundo ou de compêndio).
 */
export async function enviarCaixasDeSussurro({ destinos, pergunta, itens = [] }) {
  if (!game.user.isGM) return;
  const ofertas = [];
  for (const uuid of itens) {
    const item = await fromUuid(uuid);
    if (item) ofertas.push({ uuid, nome: item.name, img: item.img });
  }
  for (const d of destinos) await criarCaixa({ ...d, pergunta, itens: ofertas });
}

/** Donos (jogadores) de um personagem: o atribuído primeiro. */
export function jogadoresDe(ator) {
  return game.users.filter((u) => !u.isGM && (u.character?.id === ator?.id || ator?.testUserPermission?.(u, "OWNER")));
}

/** Janela do mestre: para quem, a mensagem e itens arrastados para ofertar. */
export async function abrirCaixaDeSussurro() {
  if (!game.user.isGM) return;
  const jogadores = game.users.filter((u) => !u.isGM);
  if (!jogadores.length) return void ui.notifications.warn(L("SemJogadores"));
  const ofertados = new Map();
  const resposta = await DialogV2.wait({
    window: { title: L("Titulo"), icon: "fa-solid fa-comment-dots" },
    classes: ["op2", "op2-sussurro-janela"],
    position: { width: 480 },
    content: `<div class="op2-sussurro-janela__corpo">
      <fieldset><legend>${esc(L("SussurrarCom"))}</legend>
        ${jogadores.map((u) => `<label class="op2-sussurro-janela__jogador"><input type="checkbox" name="usuario" value="${u.id}">
          ${esc(u.name)}${u.character ? ` <em>(${esc(u.character.name)})</em>` : ""}${u.active ? "" : ` <small>${esc(L("Offline"))}</small>`}</label>`).join("")}
      </fieldset>
      <label>${esc(L("SuaMensagem"))}<textarea name="pergunta" rows="4" placeholder="${esc(L("Placeholder"))}"></textarea></label>
      <div class="op2-sussurro-janela__soltar" data-op2-sussurro-soltar>
        <i class="fa-solid fa-gift"></i> ${esc(L("ArrasteItens"))}
        <ul data-op2-sussurro-lista></ul>
      </div>
    </div>`,
    render: (_ev, dialogo) => {
      const raiz = dialogo.element;
      const zona = raiz.querySelector("[data-op2-sussurro-soltar]");
      const lista = raiz.querySelector("[data-op2-sussurro-lista]");
      const desenhar = () => {
        lista.innerHTML = [...ofertados.values()].map((it) => `<li><img src="${esc(it.img)}" alt=""><span>${esc(it.name)}</span>
          <button type="button" class="op2-botao-icone" data-tirar="${esc(it.uuid)}"><i class="fa-solid fa-xmark"></i></button></li>`).join("");
        for (const b of lista.querySelectorAll("[data-tirar]")) {
          b.addEventListener("click", () => { ofertados.delete(b.dataset.tirar); desenhar(); });
        }
      };
      zona.addEventListener("dragover", (ev) => { ev.preventDefault(); zona.classList.add("sobre"); });
      zona.addEventListener("dragleave", () => zona.classList.remove("sobre"));
      zona.addEventListener("drop", async (ev) => {
        ev.preventDefault();
        zona.classList.remove("sobre");
        let dados;
        try { dados = JSON.parse(ev.dataTransfer.getData("text/plain")); } catch { return; }
        if (dados?.type !== "Item") return void ui.notifications.warn(L("SoItens"));
        const item = await fromUuid(dados.uuid);
        if (item) ofertados.set(item.uuid, item);
        desenhar();
      });
    },
    buttons: [{
      action: "enviar", label: L("Enviar"), icon: "fa-solid fa-paper-plane", default: true,
      callback: (_ev, botao) => ({
        usuarios: [...botao.form.querySelectorAll("[name=usuario]:checked")].map((c) => c.value),
        pergunta: botao.form.elements.pergunta.value.trim(),
      }),
    }],
    rejectClose: false,
  });
  if (!resposta) return;
  if (!resposta.usuarios.length) return void ui.notifications.warn(L("EscolhaJogador"));
  if (!resposta.pergunta && !ofertados.size) return void ui.notifications.warn(L("SemConteudo"));
  await enviarCaixasDeSussurro({
    destinos: resposta.usuarios.map((usuarioId) => ({ usuarioId })),
    pergunta: resposta.pergunta, itens: [...ofertados.keys()],
  });
  ui.notifications.info(L("Enviado"));
}

/* -- chat: liga a caixa e o botão de revelar ------------------------------------ */

function ligar(msg, html) {
  const f = msg.flags?.[SYSTEM_ID];
  if (f?.tipo !== "sussurro") return;
  if (f.caixa) {
    const ehAlvo = game.user.id === f.usuarioId;
    const lugar = html.querySelector("[data-op2-sussurro-form]");
    if (lugar) {
      lugar.innerHTML = ehAlvo
        ? `<textarea class="op2-sussurro__texto" rows="3" placeholder="${esc(L("ResponderPlaceholder"))}"></textarea>
           <button type="button" class="op2-botao op2-botao--pequeno op2-sussurro__enviar"><i class="fa-solid fa-user-secret"></i> ${esc(L("ResponderEnviar"))}</button>`
        : `<p class="op2-dica">${esc(L("Aguardando", { nome: f.nomeAlvo }))}</p>`;
      lugar.querySelector(".op2-sussurro__enviar")?.addEventListener("click", async (ev) => {
        const texto = lugar.querySelector("textarea").value.trim();
        if (!texto) return void ui.notifications.warn(L("Vazio"));
        ev.currentTarget.disabled = true;
        await comoMestre("op2SussurroResposta", { mensagemId: msg.id, texto });
      });
    }
    for (const b of html.querySelectorAll("[data-op2-sussurro-aceitar]")) {
      if (!ehAlvo) { b.remove(); continue; }
      b.addEventListener("click", async () => {
        b.disabled = true;
        await comoMestre("op2SussurroAceitar", { mensagemId: msg.id, itemUuid: b.dataset.op2SussurroAceitar });
      });
    }
  }
  if (f.resposta && game.user.isGM) {
    html.querySelector("[data-op2-sussurro-revelar]")?.addEventListener("click", async () => {
      await msg.update({
        whisper: [],
        content: msg.content.replace(/<div class="op2-sussurro__mestre"[\s\S]*?<\/div>/, `<p class="op2-dica"><i class="fa-solid fa-eye"></i> ${esc(L("Revelada"))}</p>`),
      });
    });
  }
}

export function registrarSussurro() {
  registrarAcaoDeMestre("op2SussurroResposta", receberResposta);
  registrarAcaoDeMestre("op2SussurroAceitar", aceitarItem);
  Hooks.on("renderChatMessageHTML", ligar);
}
