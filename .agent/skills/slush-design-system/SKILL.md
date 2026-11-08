---
name: slush-design-system
description: "Aplica rigorosamente o Design System Slush ('Inflatable sticker universe on pastel paper'): tipografia display gigante esmagada (Lateral 800 com line-height 0.75-0.80), fitas 3D azul elétrico, colagem de adesivos multicoloridos com contornos manuais pretos de 1px, botões pílula de 1600px e faixas de cores pastéis sólidas. Use sempre que criar novas interfaces, landing pages ou componentes inspirados nesta identidade."
---

# Slush Design System — Diretriz de Engenharia e Estilo
> **Metáfora Central:** *Inflatable sticker universe on pastel paper* (Universo de adesivos infláveis sobre papel pastel).  
> **Fonte de Verdade:** `design.md` (Slush Style Reference).

---

## 1. Filosofia & Manifesto de Design

O design **Slush** recusa terminantemente a estética fria de SaaS corporativo tradicional, templates cinzentos de IA e dashboards genéricos. 

Ele opera sob a lógica física de um **álbum de adesivos e colagem sobre papel**:
1. **Papel Pastel como Canvas:** A página se divide em grandes faixas sólidas de cor que alternam suavemente pelo scroll (`#dceeff` Sky Wash → `#ffffff` Paper White → `#cccccc` Concrete Gray).
2. **Esculturas Tipográficas Esmagadas:** Títulos display em peso 800 com tamanhos colossais (200px a 640px) e **line-height ultra-esmagado (0.75 a 0.80)**. As palavras não funcionam como frases comuns de leitura rápida, mas sim como esculturas físicas tridimensionais no espaço.
3. **Fitas 3D Infláveis em Azul Elétrico (`#4da2ff`):** O elemento-assinatura volumétrico em formato tubular granulado que envolve e passa por trás das letras.
4. **Paleta de Adesivos como Confete:** Seis cores altamente saturadas aparecem simultaneamente espalhadas como adesivos recortados, tags ou pequenas superfícies. NUNCA se escolhe apenas uma cor de acento.
5. **Recorte Manual com Linha Preta de 1px:** Todos os componentes interativos, botões pílula, cards e adesivos decorativos possuem borda sólida preta de 1px (`#000000`), simulando o contorno de adesivos recortados com tesoura.
6. **Suavidade Extrema nos Cantos:** Raios de curvatura generosos (`1600px` para pílulas e botões; `20px` a `40px` para cards). Cantos vivos são expressamente proibidos.
7. **Zero Gradientes e Zero Box-Shadows:** A profundidade vem exclusivamente do contraste entre as faixas de cores pastéis, os contornos pretos e a textura das fitas 3D. Gradientes e sombras convencionais quebram imediatamente o efeito de papel físico e são estritamente vetados.

---

## 2. Tokens de Design (Fonte Canônica)

### 2.1 Paleta de Cores

| Nome | Hexadecimal | Variável CSS | Papel e Regra de Uso |
| :--- | :--- | :--- | :--- |
| **Carbon** | `#000000` | `--color-carbon` | Texto principal, bordas de 1px de cards/botões/adesivos, preenchimento de CTAs principais e logomarca. Cria o contorno artesanal. |
| **Paper White** | `#ffffff` | `--color-paper-white` | Fundo principal da página, superfícies de cards, preenchimento de botões contornados e fundo de QR Codes. |
| **Sky Wash** | `#dceeff` | `--color-sky-wash` | Fundo pastel do Hero e faixas primárias da página. |
| **Concrete Gray** | `#cccccc` | `--color-concrete-gray` | Fundo da seção secundária; respiro neutro entre blocos visuais. |
| **Soft Mist** | `#e9e9e9` | `--color-soft-mist` | Superfícies sutis, estados desabilitados e divisores suaves. |
| **Electric Blue** | `#4da2ff` | `--color-electric-blue` | **Cor-âncora de marca.** Esculturas 3D infláveis, faixas de destaque e superfícies decorativas. **PROIBIDO usar em botões/CTAs de ação.** |
| **Mint Pop** | `#55db9c` | `--color-mint-pop` | Verde wash para adesivos, faixas decorativas e tags de ênfase. **PROIBIDO usar como status semântico de sucesso.** |
| **Lavender** | `#e9ccff` | `--color-lavender` | O acento mais suave da paleta; usado para cards de destaque, tags e preenchimento de adesivos. |
| **Ember** | `#fb4903` | `--color-ember` | Acento quente/vibrante para ícones adesivos, foguetes e badges de alta energia. |
| **Sunburst** | `#ffd731` | `--color-sunburst` | Amarelo solar para moedas e adesivos. **NUNCA usar como fundo de texto legível.** |
| **Voltage Violet** | `#5c4ade` | `--color-voltage-violet` | Roxo profundo para cartões de download/QR e adesivos de carteira. |

### 2.2 Tipografia

#### Tipografia Display — **Lateral** (ou Druk, Bowlby One, Antonio)
* **Peso:** 800 (Extra Bold)
* **Tamanhos:** 70px, 110px, 160px, 200px, 281px, até 640px
* **Line-height Obrigatório:** **0.75 a 0.80** (Inviolável: o espaçamento deve ser esmagado para que as linhas toquem umas nas outras criando blocos monolíticos).
* **Letter-spacing:** normal / 0px
* **Papel:** Títulos monumentais e banners esculturais.

#### Tipografia de Interface & Corpo — **Aeonik Pro** (ou Inter, Satoshi, General Sans)
* **Pesos:** 500 (Medium) para texto corrido e metadados; 700 (Bold) para navegação, botões e subtítulos.
* **Tamanhos:** 12px, 13px, 14px, 15px, 16px, 24px, 30px, 64px.
* **Line-height:** 1.00 a 1.56.
* **Letter-spacing:**
  * Corpo de texto (14–16px): `-0.010em` (densidade precisa).
  * Botões, tags e navegação em pílula: `+0.030em` a `+0.032em` (espaçamento arejado para labels em caixa alta dentro de pílulas).
* **OpenType Features:** `"ss01" on, "tnum"` (numerais tabulares).

#### Escala Tipográfica Padronizada

```css
--text-caption: 12px;       --leading-caption: 1.56;   --tracking-caption: -0.01px;
--text-body-lg: 15px;       --leading-body-lg: 1.39;   --tracking-body-lg: -0.01px;
--text-subheading: 24px;    --leading-subheading: 1.2; --tracking-subheading: -0.01px;
--text-heading-sm: 30px;    --leading-heading-sm: 1.1; --tracking-heading-sm: -0.01px;
--text-heading: 64px;       --leading-heading: 1.0;    --tracking-heading: -0.01px;
--text-display: 200px;      --leading-display: 0.80;   --tracking-display: 0px;
--text-display-lg: 640px;   --leading-display-lg: 0.75; --tracking-display-lg: 0px;
```

### 2.3 Espaçamentos & Geometria

* **Unidade Base:** 4px (Grade: 4, 8, 12, 16, 20, 24, 28, 32, 40, 48, 60, 80, 128, 180, 224px).
* **Densidade:** Confortável e arejada.
* **Largura Máxima da Página:** 1440px (mínimo de respiro: 1280px).
* **Gap entre seções:** 48px a 80px.
* **Padding interno de Cards:** 24px.
* **Gap entre elementos de controle:** 4px a 12px.

#### Raio de Curvatura (Border Radius)
* **Botões, Nav Links, Tags, Pílulas:** `1600px` (Pill total).
* **Cards Padrão:** `20px`.
* **Cards Elevados / Destaque:** `40px`.
* **Adesivos e Ícones:** `16px` a `20px`.
* **Container de Corpo:** `30px`.

---

## 3. Regras Inegociáveis (Do's & Don'ts)

### O que FAZER (Do):
1. **Esmagar o Leading Display:** Usar impreterivelmente `line-height: 0.75–0.80` nos títulos Lateral 800. Se parecer um texto tradicional com entrelinha normal, está ERRADO.
2. **Explodir a Paleta de Adesivos:** Distribuir múltiplas cores do arco-íris de adesivos (Ember, Mint Pop, Lavender, Sunburst, Voltage Violet) pela tela em formato de tags, ilustrações ou fundos de card.
3. **Bordas Pretas Recortadas:** Manter a borda `1px solid #000000` em todos os botões, cards, pílulas e adesivos.
4. **Formas Ultra-Arredondadas:** Pílulas de `1600px` para botões e `20px–40px` para cards.
5. **Alternância de Faixas de Cor:** Fazer a transição de scroll através de blocos inteiros coloridos (`#dceeff` → `#ffffff` → `#cccccc`).
6. **Composição em Colagem:** Permitir adesivos inclinados/rotacionados (`transform: rotate(-6deg)`) flutuando e sobrepondo títulos e caixas.
7. **Espaçamento de Botões:** Utilizar `letter-spacing: 0.032em` em botões e navegação para garantir equilíbrio visual.

### O que NUNCA FAZER (Don't):
1. **NUNCA usar sombras (`box-shadow`):** A estética do Slush é gráfica e de papel. O relevo visual vem das fitas 3D e do contraste de cores, não de sombras projetadas.
2. **NUNCA usar gradientes:** Todas as superfícies são sólidas e planas.
3. **NUNCA usar o Azul Elétrico (`#4da2ff`) em botões ou CTAs:** Ele é exclusivamente uma cor escultural de fundo ou fita 3D. Os botões de ação são SEMPRE pretos com texto branco (`#000000` fill) ou brancos contornados de preto.
4. **NUNCA usar o Verde (`#55db9c`) como status de "Sucesso":** Ele não possui semântica funcional de sistema, é apenas um adesivo decorativo vibrante.
5. **NUNCA usar border-radius inferior a 16px em cards ou inferior a 1600px em botões:** Cantos retos destroem a sensação de adesivo emborrachado.
6. **NUNCA usar line-height acima de 0.85 em títulos gigantes:** Letras afastadas verticalmente arruínam o aspecto monolítico escultural.
7. **NUNCA encolher o layout abaixo de 1280px no desktop:** Tipografias display gigantes e fitas 3D necessitam de amplitude horizontal.

---

## 4. Biblioteca Canônica de Componentes

### 4.1 Barra Superior Marquee
Faixa preta full-bleed no topo extremo com texto em loop infinito:
```html
<div class="slush-marquee">
  <div class="slush-marquee-content">
    <span>AGENDAMENTO ONLINE IMEDIATO &bull; CORTE &bull; BARBA &bull; SEM APLICATIVOS &bull; 100% MOBILE &bull;</span>
    <span>AGENDAMENTO ONLINE IMEDIATO &bull; CORTE &bull; BARBA &bull; SEM APLICATIVOS &bull; 100% MOBILE &bull;</span>
  </div>
</div>
```
```css
.slush-marquee {
  width: 100%;
  background: #000000;
  border-bottom: 1px solid #000000;
  overflow: hidden;
  white-space: nowrap;
  padding: 6px 0;
}
.slush-marquee-content {
  display: inline-block;
  animation: slush-marquee-loop 20s linear infinite;
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.032em;
  color: #ffffff;
  text-transform: uppercase;
}
@keyframes slush-marquee-loop {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
```

### 4.2 Navegação em Pílula (Pill Nav)
```html
<nav class="slush-nav">
  <a href="/" class="slush-logo-pill">
    <span class="slush-logo-badge">S</span>
  </a>
  <div class="slush-nav-pill-group">
    <a href="#servicos" class="slush-pill-link">SERVIÇOS</a>
    <a href="#cortes" class="slush-pill-link">GALERIA</a>
    <a href="#barbeiros" class="slush-pill-link">EQUIPE</a>
  </div>
  <a href="#agendar" class="slush-btn-primary">AGENDAR AGORA</a>
</nav>
```
```css
.slush-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1440px;
  margin: 0 auto;
  padding: 16px 24px;
}
.slush-logo-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  background: #ffffff;
  border: 1px solid #000000;
  border-radius: 1600px;
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 800;
  font-size: 20px;
  color: #000000;
}
.slush-nav-pill-group {
  display: flex;
  gap: 6px;
  background: rgba(255, 255, 255, 0.4);
  padding: 4px;
  border-radius: 1600px;
}
.slush-pill-link {
  display: inline-flex;
  align-items: center;
  height: 38px;
  padding: 0 16px;
  background: #ffffff;
  border: 1px solid #000000;
  border-radius: 1600px;
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.032em;
  color: #000000;
  text-decoration: none;
  transition: transform 0.1s ease;
}
.slush-pill-link:hover {
  transform: translateY(-1px);
}
```

### 4.3 Botões de Ação (CTA Canônicos)
```html
<!-- CTA Principal: Preto Sólido -->
<button class="slush-btn-primary">AGENDAR HORÁRIO</button>

<!-- CTA Secundário / Ghost: Branco com Borda Preta -->
<button class="slush-btn-ghost">VER CORTES</button>
```
```css
.slush-btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0 24px;
  background: #000000;
  border: 1px solid #000000;
  border-radius: 1600px;
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.032em;
  color: #ffffff;
  text-decoration: none;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.slush-btn-primary:hover {
  transform: scale(1.02);
}

.slush-btn-ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 44px;
  padding: 0 24px;
  background: #ffffff;
  border: 1px solid #000000;
  border-radius: 1600px;
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.032em;
  color: #000000;
  text-decoration: none;
  cursor: pointer;
}
.slush-btn-ghost:hover {
  background: #e9e9e9;
}
```

### 4.4 Título Monumental Escultural (Hero Display)
```html
<section class="slush-hero-section">
  <!-- Fita 3D decorativa passando atrás -->
  <div class="slush-3d-ribbon" aria-hidden="true"></div>

  <!-- Adesivos soltos flutuantes -->
  <div class="slush-sticker sticker-rocket" style="transform: rotate(-10deg);">🚀</div>
  <div class="slush-sticker sticker-coin" style="transform: rotate(14deg);">✂️</div>

  <h1 class="slush-display-title">
    NOVA<br>BARBA
  </h1>
  <p class="slush-tagline">
    Agendamento online pelo Instagram em 30 segundos com mestres barbeiros.
  </p>
</section>
```
```css
.slush-hero-section {
  background-color: var(--color-sky-wash, #dceeff);
  min-height: 85vh;
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 80px 24px;
}

.slush-display-title {
  font-family: var(--font-lateral, 'Impact', sans-serif);
  font-weight: 800;
  font-size: clamp(80px, 15vw, 220px);
  line-height: 0.76; /* OBRIGATÓRIO: esmagado */
  letter-spacing: -0.02em;
  color: #000000;
  margin: 0 0 24px;
  text-transform: uppercase;
  position: relative;
  z-index: 2;
}

.slush-tagline {
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 500;
  font-size: clamp(16px, 2.5vw, 24px);
  line-height: 1.25;
  letter-spacing: -0.01em;
  color: #000000;
  max-width: 600px;
  margin: 0 auto 36px;
  position: relative;
  z-index: 2;
}

/* Fita tubular 3D azul que cruza a composicao */
.slush-3d-ribbon {
  position: absolute;
  width: 700px;
  height: 220px;
  background: radial-gradient(circle at 30% 30%, #70b7ff, #4da2ff 60%, #1a7fe8);
  border-radius: 120px;
  transform: rotate(-18deg) scaleY(0.7);
  opacity: 0.95;
  filter: drop-shadow(0 15px 25px rgba(26, 127, 232, 0.25));
  z-index: 1;
}

/* Adesivos físicos recortados */
.slush-sticker {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 20px;
  border: 1px solid #000000;
  font-size: 28px;
  z-index: 3;
}
.sticker-rocket {
  background-color: var(--color-ember, #fb4903);
  top: 18%;
  left: 12%;
}
.sticker-coin {
  background-color: var(--color-sunburst, #ffd731);
  bottom: 22%;
  right: 14%;
}
```

### 4.5 Card de Recorte de Conteúdo
```html
<div class="slush-card" style="background-color: #ffffff;">
  <span class="slush-tag" style="background-color: var(--color-mint-pop);">DEGRADÊ</span>
  <h3 class="slush-card-title">Corte Navalhado Clássico</h3>
  <p class="slush-card-text">Acabamento na lâmina com contorno alinhado milimetricamente.</p>
  <div class="slush-card-footer">
    <strong class="slush-price">R$ 45,00</strong>
    <button class="slush-btn-primary" style="height:36px;padding:0 16px">ESCOLHER</button>
  </div>
</div>
```
```css
.slush-card {
  border: 1px solid #000000;
  border-radius: 24px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  position: relative;
  /* ZERO BOX-SHADOW */
}
.slush-tag {
  align-self: flex-start;
  padding: 4px 10px;
  border: 1px solid #000000;
  border-radius: 1600px;
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.032em;
  color: #000000;
  margin-bottom: 14px;
}
.slush-card-title {
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 20px;
  color: #000000;
  margin: 0 0 8px;
}
.slush-card-text {
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 500;
  font-size: 14px;
  line-height: 1.4;
  color: #000000;
  margin: 0 0 20px;
}
.slush-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: auto;
}
.slush-price {
  font-family: var(--font-aeonik-pro, sans-serif);
  font-weight: 700;
  font-size: 18px;
  color: #000000;
}
```

---

## 5. Checklist de Validação Pré-Entrega (Garante Nível de Refinamento)

Antes de considerar qualquer tela ou componente concluído sob a Skill Slush, verifique cada item:

- [ ] **Títulos Monumentais:** O line-height dos títulos principais está entre `0.75` e `0.80`? (Se estiver `1.0` ou mais, corrija imediatamente).
- [ ] **Bordas Artesanais de 1px:** Todos os cards, botões, tags e adesivos têm `border: 1px solid #000000`?
- [ ] **Zero Sombras:** Não há nenhum `box-shadow` aplicado em cards ou botões?
- [ ] **Zero Gradientes em Superfícies:** Os fundos de cards, seções e botões são 100% sólidos e planos?
- [ ] **CTAs Não-Azuis:** Todos os botões de ação são pretos (`#000000`) ou brancos com borda preta? (O `#4da2ff` NÃO pode estar em CTAs).
- [ ] **Raios Suaves:** Todos os botões e tags têm `border-radius: 1600px` e os cards entre `20px` e `40px`?
- [ ] **Paleta de Confete:** Há pelo menos 3 cores de adesivos (Ember, Mint, Lavender, Sunburst, Voltage Violet) distribuídas na composição?
- [ ] **Faixas de Scroll Full-Bleed:** As seções alternam entre `#dceeff`, `#ffffff` e `#cccccc` sem linhas de corte ou divisores artificiais?
- [ ] **Espaçamento de Pílulas:** As labels em caixa alta dentro de botões e navegação possuem `letter-spacing: 0.030em–0.032em`?

---

## 6. Prompting para Subagentes & Modelos

Ao solicitar a criação de uma tela usando esta Skill, forneça as seguintes instruções de acoplamento:

> *"Execute o layout seguindo estritamente a Skill `slush-design-system`. Trate a página como uma colagem em papel pastel claro. Título gigante em peso 800 com line-height 0.78, botões pílula de 1600px com borda 1px preta, sem sombras e sem gradientes. Use o azul elétrico #4da2ff apenas como elemento decorativo/fita 3D e use o preto #000000 como CTA principal. Espalhe adesivos coloridos (laranja Ember, amarelo Sunburst, verde Mint) com contorno preto de 1px ao redor da composição."*
