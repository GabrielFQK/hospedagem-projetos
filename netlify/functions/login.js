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

    const senhaCorreta = process.env.ADMIN_PASSWORD;
    const segredo = process.env.SESSION_SECRET;
    if (!senhaCorreta || !segredo) {
        return {
            statusCode: 500,
            body: JSON.stringify({ erro: 'ADMIN_PASSWORD/SESSION_SECRET não configurados no servidor.' }),
        };
    }
    if (corpo.senha !== senhaCorreta) {
        return { statusCode: 401, body: JSON.stringify({ erro: 'Senha incorreta' }) };
    }

    const duracaoSegundos = 8 * 60 * 60; // 8 horas
    const expira = Date.now() + duracaoSegundos * 1000;
    const valor = String(expira);
    const cookie = `admin_session=${valor}.${assinar(valor, segredo)}; `
        + `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${duracaoSegundos}`;

    return {
        statusCode: 200,
        headers: { 'Set-Cookie': cookie, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
    };
};
