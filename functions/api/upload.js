// POST /api/upload  (precisa do cookie de sessão válido) — recebe a ação
// (criar / salvar / excluir) e reescreve projetos.json direto no GitHub via
// API (sem git local nenhum). O binário (.exe/.zip) NÃO passa por aqui —
// você sobe ele manualmente numa GitHub Release e só cola o link.
import { sessaoValida, githubApi, utf8ParaBase64, base64ParaUtf8, respostaJson } from './_util.js';

function gerarId(nome) {
    // normaliza (separa letra + acento) e descarta qualquer caractere que
    // não seja letra/número comum — remove os acentos junto (mais simples e
    // sem depender de range Unicode escrito à mão no regex, que varia
    // conforme o encoding do arquivo)
    return nome
        .toLowerCase()
        .normalize('NFD')
        .split('')
        .filter(c => c.charCodeAt(0) < 0x300 || c.charCodeAt(0) > 0x36f)
        .join('')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

const PUBLICOS_VALIDOS = ['', 'laudos', 'base', 'ambos'];

export async function onRequest({ request, env }) {
    if (request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }
    if (!(await sessaoValida(request, env))) {
        return respostaJson({ erro: 'Sessão inválida ou expirada, faça login de novo.' }, 401);
    }

    let dados;
    try {
        dados = await request.json();
    } catch {
        return respostaJson({ erro: 'JSON inválido' }, 400);
    }

    const acao = dados.acao;
    if (!['criar', 'salvar', 'excluir'].includes(acao)) {
        return respostaJson({ erro: 'Ação inválida.' }, 400);
    }

    const caminhoArquivo = env.GITHUB_PROJETOS_PATH || 'projetos.json';
    const branch = env.GITHUB_BRANCH || 'main';

    // 1) lê o projetos.json atual — precisa do "sha" dele pra poder
    // sobrescrever (é assim que a API do GitHub evita sobrescrever por
    // cima de uma mudança concorrente sem querer)
    const respostaAtual = await githubApi(env, `/contents/${encodeURIComponent(caminhoArquivo)}?ref=${branch}`);
    if (!respostaAtual.ok) {
        const detalhe = await respostaAtual.text().catch(() => '');
        return respostaJson({
            erro: `Não consegui ler ${caminhoArquivo} no GitHub (HTTP ${respostaAtual.status}): ${detalhe}`,
        }, 502);
    }
    const atual = await respostaAtual.json();
    const conteudoAtual = JSON.parse(base64ParaUtf8(atual.content));
    const projetos = conteudoAtual.projetos || [];

    let idAtivo;
    let mensagemCommit;

    if (acao === 'excluir') {
        const { projetoId } = dados;
        const indice = projetos.findIndex(p => p.id === projetoId);
        if (indice === -1) {
            return respostaJson({ erro: 'Projeto não encontrado.' }, 400);
        }
        projetos.splice(indice, 1);
        idAtivo = projetoId;
        mensagemCommit = `Remove ${idAtivo}`;
    } else {
        const { nome, tipo, descricao, linkDownload, rotuloBotao, versaoAtual } = dados;
        const emConstrucao = !!dados.emConstrucao;
        const oculto = !!dados.oculto;
        const novo = !!dados.novo;
        const publico = PUBLICOS_VALIDOS.includes(dados.publico) ? dados.publico : '';
        let historico = Array.isArray(dados.historico) ? dados.historico : [];
        historico = historico
            .filter(v => v && typeof v.versao === 'string' && v.versao.trim())
            .map(v => ({
                versao: String(v.versao).trim(),
                mudancas: Array.isArray(v.mudancas) ? v.mudancas.map(m => String(m).trim()).filter(Boolean) : [],
                ...(v.data ? { data: String(v.data).trim() } : {}),
            }));

        if (!nome || !tipo || !descricao) {
            return respostaJson({ erro: 'Preencha nome, tipo e descrição.' }, 400);
        }
        if (!emConstrucao && (!linkDownload || !rotuloBotao)) {
            return respostaJson({ erro: 'Preencha o link de download e o texto do botão (ou marque "Em construção").' }, 400);
        }

        const projetoBase = {
            nome, tipo, descricao,
            versaoAtual: versaoAtual || '',
            linkDownload: linkDownload || '',
            rotuloBotao: rotuloBotao || '',
            novo,
            emConstrucao,
            oculto,
            publico,
            historico,
        };

        if (acao === 'criar') {
            const id = gerarId(nome);
            if (!id || projetos.some(p => p.id === id)) {
                return respostaJson({ erro: 'Já existe um projeto com esse nome (ou nome inválido).' }, 400);
            }
            projetos.push({ id, ...projetoBase });
            idAtivo = id;
            mensagemCommit = `Cria ${idAtivo}`;
        } else {
            const indice = projetos.findIndex(p => p.id === dados.projetoId);
            if (indice === -1) {
                return respostaJson({ erro: 'Projeto não encontrado.' }, 400);
            }
            projetos[indice] = { id: dados.projetoId, ...projetoBase };
            idAtivo = dados.projetoId;
            mensagemCommit = `Atualiza ${idAtivo}`;
        }

        // o selo "Novo!" é exclusivo — só o projeto marcado fica com o selo,
        // os outros perdem automaticamente
        if (novo) {
            for (const p of projetos) p.novo = p.id === idAtivo;
        }
    }

    const novoConteudo = JSON.stringify({ projetos }, null, 2);
    const respostaCommit = await githubApi(env, `/contents/${encodeURIComponent(caminhoArquivo)}`, {
        method: 'PUT',
        body: JSON.stringify({
            message: mensagemCommit,
            content: utf8ParaBase64(novoConteudo),
            sha: atual.sha,
            branch,
        }),
    });

    if (!respostaCommit.ok) {
        const erroTexto = await respostaCommit.text();
        return respostaJson({ erro: 'Não consegui salvar no GitHub: ' + erroTexto }, 502);
    }

    return respostaJson({ ok: true, id: idAtivo });
}
