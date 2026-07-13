// Funções compartilhadas pelas duas rotas (login/upload): assinar/checar o
// cookie de sessão e conversar com a API do GitHub.
const crypto = require('crypto');

function assinar(valor, segredo) {
    return crypto.createHmac('sha256', segredo).update(valor).digest('hex');
}

function lerCookie(event, nome) {
    const cabecalho = (event.headers && (event.headers.cookie || event.headers.Cookie)) || '';
    for (const parte of cabecalho.split(';')) {
        const [chave, ...resto] = parte.trim().split('=');
        if (chave === nome) return resto.join('=');
    }
    return null;
}

function sessaoValida(event) {
    const segredo = process.env.SESSION_SECRET;
    const cookie = lerCookie(event, 'admin_session');
    if (!cookie || !segredo) return false;
    const [valor, assinatura] = cookie.split('.');
    if (!valor || !assinatura) return false;
    if (assinar(valor, segredo) !== assinatura) return false;
    return Number(valor) > Date.now();
}

// Chama a API REST do GitHub num repositório só (owner/repo vêm das
// variáveis de ambiente) — usada pra ler e sobrescrever o projetos.json.
async function githubApi(caminho, opcoes = {}) {
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const token = process.env.GITHUB_TOKEN;
    return fetch(`https://api.github.com/repos/${owner}/${repo}${caminho}`, {
        ...opcoes,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            ...(opcoes.headers || {}),
        },
    });
}

module.exports = { assinar, lerCookie, sessaoValida, githubApi };
