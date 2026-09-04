/**
 * Reconhece a página de senha do Shopify — quando a loja ainda está em
 * desenvolvimento e não foi publicada.
 *
 * Achado numa loja real: `/products.json` respondeu 200 (não 401, não 403)
 * com o HTML da página de senha no lugar do catálogo — o `JSON.parse`
 * falhava, e o erro saía genérico (`CATALOG_UNREADABLE`), sem dizer ao
 * lojista que a solução é dele: tirar a senha ou publicar a loja.
 *
 * Sinais de texto, não de estrutura: a Shopify não documenta o HTML exato
 * dessa página como contrato estável, então checar por marcação específica
 * seria frágil. O texto "This store is password protected" e "Enter store
 * password" são a cópia padrão da própria Shopify nessa tela — não muda por
 * tema, só por idioma da loja (o padrão é inglês, mesmo em loja brasileira,
 * a menos que o lojista tenha traduzido a tela de senha especificamente).
 */
export function pareceSenhaDeLoja(corpo: string): boolean {
  return corpo.includes('This store is password protected') || corpo.includes('Enter store password')
}
