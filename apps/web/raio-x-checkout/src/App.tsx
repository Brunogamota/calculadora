import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ExternalLink,
  Eye,
  Globe2,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Mail,
  Menu,
  Monitor,
  MousePointer2,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  WifiOff,
  X,
} from "lucide-react";
import type { FormEvent } from "react";

type Screen = "landing" | "running" | "result" | "waf" | "connection";

type Step = {
  label: string;
  detail: string;
};

const steps: Step[] = [
  { label: "Identificando a loja", detail: "Plataforma e estrutura encontradas" },
  { label: "Abrindo um produto", detail: "Produto disponível localizado" },
  { label: "Adicionando ao carrinho", detail: "Carrinho criado com sucesso" },
  { label: "Indo para o checkout", detail: "Fluxo de compra iniciado" },
  { label: "Lendo os meios de pagamento", detail: "Pix, cartão e parcelamento" },
  { label: "Repetindo no celular", detail: "Teste em uma tela de 390 px" },
  { label: "Montando o relatório", detail: "Priorizando o que afeta vendas" },
];

const auditStats = [
  { value: "9", label: "toques até pagar no celular", note: "média das lojas com alerta" },
  { value: "38%", label: "escondem o desconto do Pix", note: "até a última etapa" },
  { value: "1 em 4", label: "não explica o parcelamento", note: "antes do checkout" },
];

const checks = [
  { number: "01", title: "Caminho até o pagamento", text: "Quantos cliques e telas separam o produto da compra concluída." },
  { number: "02", title: "Pix, cartão e parcelamento", text: "Quando as condições aparecem e se o valor final fica claro." },
  { number: "03", title: "Experiência no celular", text: "O robô repete a compra como metade dos seus clientes faria." },
  { number: "04", title: "Sinais que geram desconfiança", text: "Nome na fatura, mensagens confusas e surpresas na última tela." },
];

function Logo() {
  return (
    <button className="logo" onClick={() => window.location.reload()} aria-label="Voltar ao início">
      <span className="logo-mark"><span /></span>
      <span>reborn</span>
    </button>
  );
}

function Spinner() {
  return <LoaderCircle className="spinner" size={18} aria-hidden="true" />;
}

function Header({ screen, onNavigate }: { screen: Screen; onNavigate: (screen: Screen) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className={`site-header ${screen !== "landing" ? "app-header" : ""}`}>
      <div className="header-inner">
        <Logo />
        <nav className="desktop-nav" aria-label="Navegação principal">
          {screen === "landing" ? (
            <>
              <a href="#o-que-verificamos">O que verificamos</a>
              <a href="#como-funciona">Como funciona</a>
              <a href="#sobre">Sobre a Reborn</a>
            </>
          ) : (
            <button className="back-link" onClick={() => onNavigate("landing")}><ArrowLeft size={15} /> Nova análise</button>
          )}
        </nav>
        <details className="state-menu">
          <summary>Ver estados <ChevronDown size={14} /></summary>
          <div className="state-popover">
            <button onClick={() => onNavigate("running")}><Monitor size={15} /> Execução ao vivo</button>
            <button onClick={() => onNavigate("result")}><Eye size={15} /> Resultado</button>
            <button onClick={() => onNavigate("waf")}><ShieldCheck size={15} /> Loja bloqueou o robô</button>
            <button onClick={() => onNavigate("connection")}><WifiOff size={15} /> Conexão interrompida</button>
          </div>
        </details>
        <button className="mobile-menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {menuOpen && (
        <div className="mobile-menu">
          <button onClick={() => { onNavigate("landing"); setMenuOpen(false); }}>Início</button>
          <button onClick={() => { onNavigate("running"); setMenuOpen(false); }}>Execução ao vivo</button>
          <button onClick={() => { onNavigate("result"); setMenuOpen(false); }}>Ver resultado</button>
          <button onClick={() => { onNavigate("waf"); setMenuOpen(false); }}>Estado de bloqueio</button>
        </div>
      )}
    </header>
  );
}

function UrlForm({ onStart, compact = false }: { onStart: (url: string) => void; compact?: boolean }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const validate = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return "Cole o endereço da sua loja para começar.";
    const candidate = cleaned.startsWith("http") ? cleaned : `https://${cleaned}`;
    try {
      const parsed = new URL(candidate);
      if (!parsed.hostname.includes(".")) return "Digite um endereço válido, como sualoja.com.br.";
      return "";
    } catch {
      return "Digite um endereço válido, como sualoja.com.br.";
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const message = validate(url);
    if (message) {
      setError(message);
      return;
    }
    setError("");
    setLoading(true);
    window.setTimeout(() => onStart(url), 900);
  };

  return (
    <form className={`url-form ${compact ? "compact" : ""} ${error ? "has-error" : ""}`} onSubmit={handleSubmit} noValidate>
      <div className="url-input-wrap">
        <Globe2 size={19} aria-hidden="true" />
        <input
          type="text"
          value={url}
          onChange={(event) => { setUrl(event.target.value); if (error) setError(""); }}
          onBlur={() => { if (url) setError(validate(url)); }}
          placeholder="sualoja.com.br"
          aria-label="Endereço da loja"
          aria-describedby="url-message"
          disabled={loading}
        />
      </div>
      <button className="primary-button" type="submit" disabled={loading}>
        {loading ? <><Spinner /> Abrindo a loja</> : "Analisar meu checkout"}
      </button>
      <p id="url-message" className="form-message">
        {error || "Análise gratuita. Você não precisa instalar nada."}
      </p>
    </form>
  );
}

function Landing({ onStart }: { onStart: (url: string) => void }) {
  return (
    <main>
      <section className="hero">
        <div className="hero-grid" aria-hidden="true" />
        <div className="hero-content">
          <div className="eyebrow"><span className="live-dot" /> Raio-X do Checkout</div>
          <h1>Descubra onde seu checkout está <span>perdendo vendas.</span></h1>
          <p className="hero-copy">Cole o endereço da sua loja. Nosso robô faz uma compra de verdade e mostra o que pode estar fazendo o cliente desistir.</p>
          <UrlForm onStart={onStart} />
          <div className="trust-line">
            <span><Check size={14} /> Sem cadastro</span>
            <span><Check size={14} /> Resultado em até 90 segundos</span>
            <span><Check size={14} /> Nenhuma compra é concluída</span>
          </div>
        </div>
        <div className="scroll-cue" aria-hidden="true"><span /> Veja o que o robô encontra</div>
      </section>

      <section className="proof-section section-shell">
        <div className="section-heading split-heading">
          <div><p className="section-kicker">O que já encontramos</p><h2>Pequenos atritos.<br />Vendas que não voltam.</h2></div>
          <p>Os números abaixo vêm de checkouts que parecem funcionar. O problema aparece quando alguém tenta comprar.</p>
        </div>
        <div className="stats-grid">
          {auditStats.map((stat) => (
            <article className="stat-card" key={stat.value}>
              <strong>{stat.value}</strong>
              <h3>{stat.label}</h3>
              <p>{stat.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="o-que-verificamos" className="checks-section section-shell">
        <div className="section-heading centered-heading">
          <p className="section-kicker">Uma compra vista por inteiro</p>
          <h2>O robô não avalia sua home.<br />Ele tenta pagar.</h2>
          <p>Do primeiro produto até a última tela antes da cobrança, no computador e no celular.</p>
        </div>
        <div className="checks-grid">
          {checks.map((item, index) => (
            <article className={`check-card card-${index + 1}`} key={item.number}>
              <span className="check-number">{item.number}</span>
              <div className="check-icon">
                {index === 0 && <MousePointer2 size={23} />}
                {index === 1 && <span className="pix-glyph">◇</span>}
                {index === 2 && <Smartphone size={23} />}
                {index === 3 && <Search size={23} />}
              </div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="como-funciona" className="process-section">
        <div className="section-shell process-shell">
          <div className="process-intro">
            <p className="section-kicker light">Como funciona</p>
            <h2>Você assiste.<br />O robô trabalha.</h2>
            <p>Não pedimos faturamento, plataforma ou telefone. A análise começa pela loja, não por um formulário.</p>
            <button className="light-button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Analisar minha loja</button>
          </div>
          <div className="process-list">
            <article><span>1</span><div><h3>Você cola o endereço</h3><p>O robô identifica a plataforma e procura um produto disponível.</p></div></article>
            <article><span>2</span><div><h3>A compra acontece ao vivo</h3><p>Você acompanha cada clique no computador e no celular.</p></div></article>
            <article><span>3</span><div><h3>O relatório mostra onde agir</h3><p>Cada achado vem com evidência e uma explicação direta.</p></div></article>
          </div>
        </div>
      </section>

      <section id="sobre" className="about-section section-shell">
        <div className="about-card">
          <div className="about-mark"><span className="logo-mark large"><span /></span></div>
          <div>
            <p className="section-kicker">Feito pela Reborn</p>
            <h2>Aprovar o pagamento é só o começo.</h2>
            <p>A Reborn constrói infraestrutura de pagamento para lojas brasileiras. Criamos este raio-x porque boa parte das vendas se perde antes mesmo de o pagamento ser tentado.</p>
          </div>
          <a href="https://reborn.co" target="_blank" rel="noreferrer">Conheça a Reborn <ExternalLink size={15} /></a>
        </div>
      </section>

      <section className="final-cta">
        <div className="section-shell">
          <p className="section-kicker">Seu checkout visto como um cliente vê</p>
          <h2>Tem venda escapando.<br />Descubra por onde.</h2>
          <UrlForm onStart={onStart} compact />
        </div>
      </section>
    </main>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const data = { title: "Raio-X do Checkout", text: "Veja a análise deste checkout", url: window.location.href };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1800);
      }
    } catch {
      // The user may cancel the native share sheet.
    }
  };
  return <button className="share-button" onClick={share}>{copied ? <Check size={16} /> : <Link2 size={16} />}{copied ? "Link copiado" : "Compartilhar"}</button>;
}

function StoreBrowser({ progress, paused = false }: { progress: number; paused?: boolean }) {
  const stage = progress < 2 ? "collection" : progress < 4 ? "product" : "checkout";
  return (
    <div className={`store-browser ${paused ? "paused" : ""}`}>
      <div className="browser-chrome">
        <div className="traffic-lights"><i /><i /><i /></div>
        <div className="browser-address"><LockKeyhole size={12} /> lojademonstracao.com.br/{stage === "product" ? "produtos/tenis" : stage === "checkout" ? "checkout" : "colecao"}</div>
        <RefreshCw size={14} />
      </div>
      <div className="store-page">
        <div className="demo-store-nav"><b>ATELIÊ</b><span>Novidades&nbsp;&nbsp;&nbsp; Feminino&nbsp;&nbsp;&nbsp; Masculino</span><div><Search size={16} /><span className="bag-icon">0</span></div></div>
        {stage === "collection" && (
          <div className="collection-view">
            <div className="collection-title"><small>NOVA COLEÇÃO</small><h3>Essenciais para<br />todos os dias</h3><button>Ver coleção</button></div>
            <div className="product-visual coral"><span>Tênis Orla</span></div>
            <div className="product-visual cream"><span>Bolsa Norte</span></div>
          </div>
        )}
        {stage === "product" && (
          <div className="product-view">
            <div className="shoe-visual"><div className="shoe">N</div></div>
            <div className="product-info"><small>NOVIDADE</small><h3>Tênis Orla</h3><p className="price">R$ 489,90</p><p>Escolha o tamanho</p><div className="sizes"><span>36</span><span>37</span><span>38</span><span>39</span></div><button>Adicionar à sacola</button></div>
          </div>
        )}
        {stage === "checkout" && (
          <div className="checkout-view">
            <div className="checkout-main"><p className="step-caption">ENTREGA &gt; PAGAMENTO</p><h3>Como você quer pagar?</h3><div className="payment-option"><Circle size={14} /> Cartão de crédito <span>›</span></div><div className="payment-option muted-payment"><Circle size={14} /> Pix <small>desconto no próximo passo</small><span>›</span></div></div>
            <div className="order-summary"><h4>Resumo</h4><div><span>Tênis Orla</span><b>R$ 489,90</b></div><div><span>Entrega</span><b>R$ 18,00</b></div><hr /><div><span>Total</span><b>R$ 507,90</b></div><button>Continuar</button></div>
          </div>
        )}
        {!paused && <div className={`robot-cursor cursor-stage-${Math.min(progress, 6)}`}><MousePointer2 fill="currentColor" size={26} /><span>robô</span></div>}
        {paused && <div className="paused-overlay"><WifiOff size={22} /><span>Imagem pausada em 00:31</span></div>}
      </div>
      <div className="browser-footer"><span><span className={`live-dot ${paused ? "gray" : ""}`} /> {paused ? "transmissão pausada" : "transmissão ao vivo"}</span><span className="mono">1280 × 720</span></div>
    </div>
  );
}

function FindingsFeed({ progress }: { progress: number }) {
  return (
    <div className="findings-feed">
      <div className="panel-title"><span>Achados até agora</span><span>{progress >= 5 ? "2" : progress >= 3 ? "1" : "0"}</span></div>
      {progress < 3 && <div className="empty-finding"><Search size={18} /><p>Os achados aparecem aqui enquanto o robô avança.</p></div>}
      {progress >= 3 && (
        <article className="live-finding"><span className="severity critical">Importante</span><h4>O desconto do Pix só aparece no fim</h4><p>Quem está comparando formas de pagamento não vê a vantagem antes de entrar no checkout.</p></article>
      )}
      {progress >= 5 && (
        <article className="live-finding new-finding"><span className="severity attention">Atenção</span><h4>No celular, são nove toques até pagar</h4><p>No computador, o mesmo caminho leva seis.</p></article>
      )}
    </div>
  );
}

function Running({ onComplete, url }: { onComplete: () => void; url: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((current) => {
        if (current >= steps.length - 1) {
          window.clearInterval(timer);
          window.setTimeout(onComplete, 1400);
          return current;
        }
        return current + 1;
      });
    }, 2700);
    return () => window.clearInterval(timer);
  }, [onComplete]);

  return (
    <main className="workspace-page">
      <div className="workspace-topbar">
        <div><span className="running-pill"><Spinner /> Análise em andamento</span><div><h1>Analisando seu checkout</h1><p>{url || "lojademonstracao.com.br"}</p></div></div>
        <ShareButton />
      </div>
      <div className="mobile-current-step"><Spinner /><span><small>Agora</small>{steps[progress].label}</span><b>{progress + 1}/{steps.length}</b></div>
      <div className="audit-workspace">
        <section className="browser-column">
          <StoreBrowser progress={progress} />
          <div className="browser-caption"><span>O robô está navegando como um cliente comum.</span><span className="mono">00:{String(Math.min(59, progress * 9 + 4)).padStart(2, "0")}</span></div>
        </section>
        <aside className="audit-sidebar">
          <div className="steps-panel">
            <div className="panel-title"><span>Etapas da análise</span><span>{progress + 1} de {steps.length}</span></div>
            <div className="step-list">
              {steps.map((step, index) => {
                const status = index < progress ? "done" : index === progress ? "active" : "waiting";
                return <div className={`step-row ${status}`} key={step.label}><span className="step-status">{status === "done" ? <Check size={14} /> : status === "active" ? <Spinner /> : <Circle size={11} />}</span><div><h3>{step.label}</h3><p>{status === "done" ? step.detail : status === "active" ? "Robô trabalhando agora" : "Aguardando"}</p></div></div>;
              })}
            </div>
          </div>
          <FindingsFeed progress={progress} />
        </aside>
      </div>
      <button className="skip-button" onClick={onComplete}>Ir para o resultado desta demonstração</button>
    </main>
  );
}

function EvidenceVisual() {
  return (
    <div className="evidence-visual">
      <div className="evidence-toolbar"><span /><span /><span /><p>lojademonstracao.com.br/checkout</p></div>
      <div className="evidence-content">
        <div className="evidence-checkout"><small>Pagamento</small><h4>Escolha uma forma de pagamento</h4><div>Cartão de crédito <span>›</span></div><div className="evidence-highlight">Pix <b>5% de desconto</b><span>›</span></div></div>
        <div className="evidence-note"><span>01</span><p>O desconto aparece pela primeira vez nesta tela, depois de 7 ações.</p></div>
      </div>
    </div>
  );
}

const lockedFindings = [
  { severity: "Importante", title: "Quem compra pelo celular precisa de nove toques até pagar", tag: "celular" },
  { severity: "Atenção", title: "O parcelamento não mostra o valor de cada parcela", tag: "clareza" },
  { severity: "Atenção", title: "O nome que aparece na fatura não lembra o nome da loja", tag: "confiança" },
];

function FindingDetail({ item, index }: { item: typeof lockedFindings[number]; index: number }) {
  return (
    <article className="unlocked-finding">
      <div className="finding-index">0{index + 2}</div>
      <div><div className="finding-meta"><span className={`severity ${index === 0 ? "critical" : "attention"}`}>{item.severity}</span><span>{item.tag}</span></div><h3>{item.title}</h3><p>{index === 0 ? "O menu móvel, o cálculo de frete e duas confirmações extras deixam o caminho 50% mais longo que no computador." : index === 1 ? "O cliente vê apenas o total da compra. O valor mensal só é revelado depois que ele escolhe o cartão." : "A cobrança usa “PG*SERVICOSBR”. Sem reconhecer a compra, o cliente pode contestar o pagamento."}</p><div className="recommendation"><CheckCircle2 size={17} /><span><b>O que fazer</b>{index === 0 ? "Reduza as confirmações antes da etapa de pagamento." : index === 1 ? "Mostre 10× de R$ 50,79 já na página do produto." : "Avise o nome da fatura ao lado do botão de compra."}</span></div></div>
    </article>
  );
}

function Result({ onRestart }: { onRestart: () => void }) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [sending, setSending] = useState(false);

  const submitEmail = (event: FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError("Digite um e-mail válido para abrir o relatório.");
      return;
    }
    setSending(true);
    window.setTimeout(() => { setSending(false); setUnlocked(true); }, 900);
  };

  return (
    <main className="result-page">
      <div className="result-heading">
        <div><span className="complete-pill"><Check size={14} /> Análise concluída</span><p className="result-domain"><Globe2 size={14} /> lojademonstracao.com.br</p></div>
        <ShareButton />
      </div>

      <section className="score-card">
        <div className="score-gauge"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="53" /><circle className="score-progress" cx="60" cy="60" r="53" /></svg><div><strong>64</strong><span>de 100</span></div></div>
        <div className="score-copy"><p>Nota do checkout</p><h1>Seu checkout funciona.<br />Mas pede esforço demais.</h1><span>Encontramos 4 pontos que podem fazer o cliente desistir antes de pagar.</span></div>
        <div className="score-summary"><div><b>1</b><span>importante</span></div><div><b>3</b><span>atenção</span></div><div><b>7</b><span>etapas testadas</span></div></div>
      </section>

      <section className="report-section">
        <div className="report-title"><div><p className="section-kicker">Primeiro achado</p><h2>O desconto do Pix chega tarde demais.</h2></div><span className="severity critical">Importante</span></div>
        <div className="primary-finding-grid">
          <div className="finding-explanation"><p>O cliente só descobre os 5% de desconto depois de abrir o carrinho, informar o CEP e entrar na etapa de pagamento.</p><p>Até lá, quem compara preço com outra loja acredita que vai pagar <b>R$ 489,90</b>, não <b>R$ 465,41</b>.</p><div className="impact-box"><span>Por que isso pesa</span><p>O Pix perde o poder de ajudar a decisão justamente quando o cliente ainda está comparando.</p></div></div>
          <EvidenceVisual />
        </div>
      </section>

      <section className={`more-findings ${unlocked ? "is-unlocked" : "is-locked"}`}>
        <div className="more-heading"><div><p className="section-kicker">Mais 3 achados</p><h2>O restante do diagnóstico</h2></div>{unlocked && <span className="opened-badge"><Check size={14} /> Relatório aberto</span>}</div>
        {unlocked ? (
          <div className="unlocked-list">{lockedFindings.map((item, index) => <FindingDetail item={item} index={index} key={item.title} />)}</div>
        ) : (
          <div className="sealed-list">
            {lockedFindings.map((item, index) => (
              <article className="sealed-finding" key={item.title}>
                <span className="sealed-number">0{index + 2}</span>
                <div><span className={`severity ${index === 0 ? "critical" : "attention"}`}>{item.severity}</span><h3>{item.title}</h3><div className="redacted-lines"><i /><i /><i /></div></div>
                <div className="seal"><LockKeyhole size={16} /><span>Explicação e correção</span></div>
              </article>
            ))}
            <form className="unlock-card" onSubmit={submitEmail} noValidate>
              <div className="unlock-icon"><Mail size={21} /></div>
              <div className="unlock-copy"><h3>Receba o diagnóstico completo</h3><p>Abra as evidências e veja o que mudar primeiro. Também enviamos uma cópia deste relatório para o seu e-mail.</p></div>
              <div className={`email-field ${emailError ? "error" : ""}`}><input type="email" placeholder="seu@ecommerce.com.br" value={email} onChange={(event) => { setEmail(event.target.value); setEmailError(""); }} aria-label="Seu e-mail" /><button type="submit" disabled={sending}>{sending ? <Spinner /> : "Abrir diagnóstico"}</button></div>
              <p className="email-message">{emailError || "Sem sequência de e-mails. Só o relatório e uma conversa, se você quiser."}</p>
            </form>
          </div>
        )}
      </section>
      <div className="result-footer"><span>Auditoria feita pelo Raio-X do Checkout, da Reborn.</span><button onClick={onRestart}><RefreshCw size={15} /> Analisar outra loja</button></div>
    </main>
  );
}

function ExceptionState({ type, onRetry, onRestart }: { type: "waf" | "connection"; onRetry: () => void; onRestart: () => void }) {
  const isWaf = type === "waf";
  return (
    <main className="workspace-page exception-page">
      <div className="workspace-topbar"><div><span className="info-pill">Análise interrompida</span><div><h1>{isWaf ? "A loja não deixou o robô entrar" : "Perdemos a conexão com a loja"}</h1><p>lojademonstracao.com.br</p></div></div><ShareButton /></div>
      <div className="exception-layout">
        <StoreBrowser progress={isWaf ? 0 : 4} paused />
        <section className="exception-content">
          <div className="exception-icon">{isWaf ? <ShieldCheck size={29} /> : <WifiOff size={29} />}</div>
          <p className="section-kicker">Isso também diz algo sobre a loja</p>
          <h2>{isWaf ? "A proteção bloqueou uma visita que parecia automatizada." : "A página parou de responder durante o pagamento."}</h2>
          <p>{isWaf ? "Algumas lojas usam uma barreira contra robôs. Ela protege contra abuso, mas também pode bloquear comparadores de preço, ferramentas de acessibilidade e outros acessos legítimos." : "O robô chegou até o checkout, mas a loja deixou de responder por mais de 20 segundos. Um cliente nessa situação provavelmente fecharia a página."}</p>
          <div className="captured-data"><h3>O que conseguimos registrar</h3><div><span><Check size={14} /> Página inicial abriu normalmente</span><span>{isWaf ? <X size={14} /> : <Check size={14} />} {isWaf ? "Acesso ao produto foi negado" : "Produto e carrinho carregaram"}</span><span>{isWaf ? <Circle size={12} /> : <X size={14} />} {isWaf ? "Checkout não pôde ser testado" : "Checkout parou na etapa de pagamento"}</span></div></div>
          <div className="exception-actions"><button className="primary-button" onClick={onRetry}><RefreshCw size={16} /> Tentar novamente</button><button className="secondary-button" onClick={onRestart}>Testar outro endereço</button></div>
          <p className="support-note">Se a loja for sua, você pode liberar temporariamente o acesso do robô e repetir a análise.</p>
        </section>
      </div>
    </main>
  );
}

function Footer() {
  return <footer className="site-footer"><div><Logo /><p>Infraestrutura para o pagamento continuar funcionando depois da aprovação.</p></div><span>Reborn © 2026</span></footer>;
}

function App() {
  const [screen, setScreen] = useState<Screen>("landing");
  const [storeUrl, setStoreUrl] = useState("");

  const start = (url: string) => { setStoreUrl(url); setScreen("running"); window.scrollTo(0, 0); };
  const navigate = (next: Screen) => { setScreen(next); window.scrollTo(0, 0); };

  return (
    <div className="app">
      <Header screen={screen} onNavigate={navigate} />
      {screen === "landing" && <><Landing onStart={start} /><Footer /></>}
      {screen === "running" && <Running url={storeUrl} onComplete={() => navigate("result")} />}
      {screen === "result" && <Result onRestart={() => navigate("landing")} />}
      {screen === "waf" && <ExceptionState type="waf" onRetry={() => navigate("running")} onRestart={() => navigate("landing")} />}
      {screen === "connection" && <ExceptionState type="connection" onRetry={() => navigate("running")} onRestart={() => navigate("landing")} />}
    </div>
  );
}

export default App;
