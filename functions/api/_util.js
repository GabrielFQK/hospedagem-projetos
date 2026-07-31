// Funções compartilhadas pelas duas rotas (login/upload) no Cloudflare
// Pages Functions: assinar/checar o cookie de sessão, conversar com a API
// do GitHub e converter texto UTF-8 <-> base64 (Buffer do Node não existe
// no runtime do Workers, então usamos Web Crypto / TextEncoder).

export async function assinar(valor, segredo) {
    const encoder = new TextEncoder();
    const chave = await crypto.subtle.importKey(
        'raw',
        encoder.encode(segredo),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const assinatura = await crypto.subtle.sign('HMAC', chave, encoder.encode(valor));
    return [...new Uint8Array(assinatura)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function lerCookie(request, nome) {
    const cabecalho = request.headers.get('Cookie') || '';
    for (const parte of cabecalho.split(';')) {
        const [chave, ...resto] = parte.trim().split('=');
        if (chave === nome) return resto.join('=');
    }
    return null;
}

export async function sessaoValida(request, env) {
    const segredo = env.SESSION_SECRET;
    const cookie = lerCookie(request, 'admin_session');
    if (!cookie || !segredo) return false;
    const [valor, assinatura] = cookie.split('.');
    if (!valor || !assinatura) return false;
    if ((await assinar(valor, segredo)) !== assinatura) return false;
    return Number(valor) > Date.now();
}

// Chama a API REST do GitHub num repositório só (owner/repo vêm das
// variáveis de ambiente) — usada pra ler e sobrescrever o projetos.json.
export async function githubApi(env, caminho, opcoes = {}) {
    const owner = env.GITHUB_OWNER;
    const repo = env.GITHUB_REPO;
    const token = env.GITHUB_TOKEN;
    return fetch(`https://api.github.com/repos/${owner}/${repo}${caminho}`, {
        ...opcoes,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'User-Agent': 'hospedagem-projetos-admin',
            ...(opcoes.headers || {}),
        },
    });
}

export function utf8ParaBase64(texto) {
    const bytes = new TextEncoder().encode(texto);
    let binario = '';
    for (const b of bytes) binario += String.fromCharCode(b);
    return btoa(binario);
}

export function base64ParaUtf8(base64) {
    const binario = atob(base64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

export function respostaJson(dados, status = 200, headersExtras = {}) {
    return new Response(JSON.stringify(dados), {
        status,
        headers: { 'Content-Type': 'application/json', ...headersExtras },
    });
}
