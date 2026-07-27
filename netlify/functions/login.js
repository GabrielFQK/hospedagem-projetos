// POST /api/login  { senha }  ->  confere a senha (variável de ambiente
// ADMIN_PASSWORD, nunca no código) e, se bater, devolve um cookie de sessão
// assinado (HMAC com SESSION_SECRET) válido por 8 horas.
const { assinar } = require('./_util');

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method not allowed' };
    }

    let corpo;
    try {
        corpo = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: JSON.stringify({ erro: 'JSON inválido' }) };
    }

    // Em "netlify dev" (ambiente local), o próprio Netlify CLI define
    // NETLIFY_DEV=true — isso nunca acontece em produção, então liberar o
    // login sem senha aqui é seguro e não afeta o site publicado.
    const rodandoLocal = process.env.NETLIFY_DEV === 'true';

    const senhaCorreta = process.env.ADMIN_PASSWORD;
    const segredo = rodandoLocal ? (process.env.SESSION_SECRET || 'segredo-local-dev') : process.env.SESSION_SECRET;
    if (!rodandoLocal && (!senhaCorreta || !segredo)) {
        return {
            statusCode: 500,
            body: JSON.stringify({ erro: 'ADMIN_PASSWORD/SESSION_SECRET não configurados no servidor.' }),
        };
    }
    if (!rodandoLocal && corpo.senha !== senhaCorreta) {
        return { statusCode: 401, body: JSON.stringify({ erro: 'Senha incorreta' }) };
    }

    const duracaoSegundos = 8 * 60 * 60; // 8 horas
    const expira = Date.now() + duracaoSegundos * 1000;
    const valor = String(expira);
    // "Secure" exige HTTPS — em localhost (netlify dev, HTTP puro) o
    // navegador descarta o cookie se essa flag estiver presente.
    const atributoSecure = rodandoLocal ? '' : 'Secure; ';
    const cookie = `admin_session=${valor}.${assinar(valor, segredo)}; `
        + `Path=/; HttpOnly; ${atributoSecure}SameSite=Strict; Max-Age=${duracaoSegundos}`;

    return {
        statusCode: 200,
        headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
    };
};
