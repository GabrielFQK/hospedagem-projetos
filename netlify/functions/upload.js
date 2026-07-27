// POST /api/upload  (precisa do cookie de sessão válido) — recebe a ação
// (criar / salvar / excluir) e reescreve projetos.json direto no GitHub via
// API (sem git local nenhum). O binário (.exe/.zip) NÃO passa por aqui —
// você sobe ele manualmente numa GitHub Release e só cola o link.
const { sessaoValida, githubApi } = require('./_util');

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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }
    if (!sessaoValida(event)) {
        return { statusCode: 401, body: JSON.stringify({ erro: 'Sessão inválida ou expirada, faça login de novo.' }) };
    }

    let dados;
    try {
        dados = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: JSON.stringify({ erro: 'JSON inválido' }) };
    }

    const acao = dados.acao;
    if (!['criar', 'salvar', 'excluir'].includes(acao)) {
        return { statusCode: 400, body: JSON.stringify({ erro: 'Ação inválida.' }) };
    }

    const caminhoArquivo = process.env.GITHUB_PROJETOS_PATH || 'projetos.json';
    const branch = process.env.GITHUB_BRANCH || 'main';

    // 1) lê o projetos.json atual — precisa do "sha" dele pra poder
    // sobrescrever (é assim que a API do GitHub evita sobrescrever por
    // cima de uma mudança concorrente sem querer)
    const respostaAtual = await githubApi(`/contents/${encodeURIComponent(caminhoArquivo)}?ref=${branch}`);
    if (!respostaAtual.ok) {
        const detalhe = await respostaAtual.text().catch(() => '');
        return {
            statusCode: 502,
            body: JSON.stringify({
                erro: `Não consegui ler ${caminhoArquivo} no GitHub (HTTP ${respostaAtual.status}): ${detalhe}`,
            }),
        };
    }
    const atual = await respostaAtual.json();
    const conteudoAtual = JSON.parse(Buffer.from(atual.content, 'base64').toString('utf-8'));
    const projetos = conteudoAtual.projetos || [];

    let idAtivo;
    let mensagemCommit;

    if (acao === 'excluir') {
        const { projetoId } = dados;
        const indice = projetos.findIndex(p => p.id === projetoId);
        if (indice === -1) {
            return { statusCode: 400, body: JSON.stringify({ erro: 'Projeto não encontrado.' }) };
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
            return { statusCode: 400, body: JSON.stringify({ erro: 'Preencha nome, tipo e descrição.' }) };
        }
        if (!emConstrucao && (!linkDownload || !rotuloBotao)) {
            return { statusCode: 400, body: JSON.stringify({ erro: 'Preencha o link de download e o texto do botão (ou marque "Em construção").' }) };
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
                return { statusCode: 400, body: JSON.stringify({ erro: 'Já existe um projeto com esse nome (ou nome inválido).' }) };
            }
            projetos.push({ id, ...projetoBase });
            idAtivo = id;
            mensagemCommit = `Cria ${idAtivo}`;
        } else {
            const indice = projetos.findIndex(p => p.id === dados.projetoId);
            if (indice === -1) {
                return { statusCode: 400, body: JSON.stringify({ erro: 'Projeto não encontrado.' }) };
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
    const respostaCommit = await githubApi(`/contents/${encodeURIComponent(caminhoArquivo)}`, {
        method: 'PUT',
        body: JSON.stringify({
            message: mensagemCommit,
            content: Buffer.from(novoConteudo, 'utf-8').toString('base64'),
            sha: atual.sha,
            branch,
        }),
    });

    if (!respostaCommit.ok) {
        const erroTexto = await respostaCommit.text();
        return { statusCode: 502, body: JSON.stringify({ erro: 'Não consegui salvar no GitHub: ' + erroTexto }) };
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true, id: idAtivo }) };
};
