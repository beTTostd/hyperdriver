import type { Metadata } from "next";
import Link from "next/link";
import Brand from "../components/brand";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Política de Privacidade — Extensão Hyperdriver",
  description:
    "Saiba como a extensão Hyperdriver — Histórico Talishar trata, armazena e sincroniza dados de replays.",
};

const sections = [
  { id: "sobre", label: "Sobre esta política" },
  { id: "informacoes", label: "Informações tratadas" },
  { id: "obtencao", label: "Como as informações são obtidas" },
  { id: "finalidades", label: "Finalidades do tratamento" },
  { id: "armazenamento", label: "Armazenamento local e retenção" },
  { id: "sincronizacao", label: "Sincronização com o Hyperdriver" },
  { id: "analise", label: "Análises e aprendizado coletivo" },
  { id: "compartilhamento", label: "Compartilhamento de informações" },
  { id: "retencao", label: "Retenção no Hyperdriver" },
  { id: "seguranca", label: "Segurança" },
  { id: "controle", label: "Controle do usuário" },
  { id: "uso-limitado", label: "Uso Limitado" },
  { id: "alteracoes", label: "Alterações desta política" },
  { id: "contato", label: "Contato" },
];

export default function PrivacyPolicyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Brand subtitle="Game intelligence" />
        <Link className={styles.backLink} href="/">
          Voltar ao início
        </Link>
      </header>

      <section className={styles.hero} aria-labelledby="policy-title">
        <div>
          <p className={styles.eyebrow}><span>Legal / 001</span> Extensão Hyperdriver</p>
          <h1 id="policy-title">Política de<br /><em>Privacidade</em></h1>
        </div>
        <div className={styles.heroMeta}>
          <span>Última atualização</span>
          <time dateTime="2026-08-25">25 de agosto de 2026</time>
          <p>Como tratamos os dados usados para registrar, reconstruir e sincronizar suas partidas.</p>
        </div>
      </section>

      <div className={styles.layout}>
        <aside className={styles.index} aria-label="Índice da política">
          <p>Índice do documento</p>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>{section.label}</a>
              </li>
            ))}
          </ol>
        </aside>

        <article className={styles.document}>
          <section id="sobre">
            <SectionTitle number="01">Sobre esta política</SectionTitle>
            <p>Esta Política de Privacidade explica como a extensão <strong>Hyperdriver — Histórico Talishar</strong> coleta, processa, armazena e transmite informações para registrar partidas realizadas no Talishar, gerar replays e sincronizá-los com a conta do usuário no Hyperdriver.</p>
            <p>A extensão processa dados originados do <code>talishar.net</code> e do fluxo de atualização hospedado em <code>api.talishar.net</code>. A sincronização ocorre exclusivamente com os ambientes oficiais <code>hyperdriver.com.br</code> e <code>beta.hyperdriver.com.br</code>.</p>
          </section>

          <section id="informacoes">
            <SectionTitle number="02">Informações tratadas</SectionTitle>
            <p>Para produzir o histórico e reconstruir as partidas, a extensão pode tratar as seguintes categorias de informações:</p>
            <ul>
              <li><strong>Dados da partida:</strong> cartas e respectivas zonas, vida dos jogadores, contagem do deck, turno, jogador ativo, fase, cadeia de combate, poder, defesa, recursos, action points, prioridade, alternativas apresentadas, formato da partida, resultado e link HTTPS validado da lista do deck.</li>
              <li><strong>Decisões durante a partida:</strong> código da ação efetivamente escolhida, zona e identificador sanitizado da carta ou opção. A extensão não guarda o corpo bruto da requisição que realizou a jogada.</li>
              <li><strong>Metadados do replay:</strong> identificador da gravação, URL da página da partida, horários de início, atualização e término, quantidade de eventos, tamanho estimado, estado de exportação, estado de sincronização e eventuais erros técnicos.</li>
              <li><strong>Identificação associada à sincronização:</strong> nome de usuário e identificador do replay retornados pelo Hyperdriver após o envio para a conta autenticada.</li>
              <li><strong>Arquivos importados:</strong> informações presentes nos arquivos JSON que o próprio usuário selecionar para importar pelo popup da extensão.</li>
              <li><strong>Dados processados temporariamente:</strong> o fluxo de atualização do Talishar pode conter informações de autenticação, conta, chat e interface. Campos conhecidos de autenticação, como tokens, cookies, senhas e identificadores de sessão, são removidos antes do armazenamento. O conteúdo do chat não é armazenado nem enviado ao Hyperdriver, podendo ser examinado temporariamente apenas para reconhecer mensagens padronizadas de vitória ou concessão.</li>
            </ul>
            <p>A extensão não coleta localização geográfica, informações financeiras, informações de saúde, teclas digitadas, posição do mouse ou histórico de navegação fora dos domínios necessários ao seu funcionamento.</p>
          </section>

          <section id="obtencao">
            <SectionTitle number="03">Como as informações são obtidas</SectionTitle>
            <p>A captura começa quando o usuário, com a extensão instalada e ativa, acessa uma página de partida no Talishar.</p>
            <p>A extensão observa o fluxo de atualizações utilizado pela própria partida e, nos endpoints de ação do Talishar, registra somente a escolha efetiva em uma lista fechada de campos: código da ação, zona e identificador da carta ou opção. Ela cria uma representação compacta dos eventos necessários para gerar o replay e a análise pós-partida.</p>
            <p>Parâmetros de autenticação, nome da partida, identificadores de sessão, chat e corpos brutos das requisições não entram nos eventos de decisão.</p>
            <p>O usuário também pode importar voluntariamente um ou mais replays em formato JSON pelo popup da extensão.</p>
          </section>

          <section id="finalidades">
            <SectionTitle number="04">Finalidades do tratamento</SectionTitle>
            <p>As informações são utilizadas exclusivamente para:</p>
            <ul>
              <li>Registrar e reconstruir partidas do Talishar como replays.</li>
              <li>Manter um histórico local de partidas no navegador.</li>
              <li>Permitir que o usuário importe, baixe ou exclua replays.</li>
              <li>Sincronizar replays concluídos com a conta autenticada no Hyperdriver.</li>
              <li>Exibir o progresso da sincronização.</li>
              <li>Diagnosticar falhas de captura ou envio.</li>
              <li>Permitir a visualização e análise das partidas no Hyperdriver.</li>
              <li>Produzir, após a partida, comparações entre a linha executada e a melhor linha encontrada pelo avaliador.</li>
              <li>Medir padrões recorrentes e melhorar a cobertura e a calibração do avaliador com exemplos derivados pseudonimizados, conforme as salvaguardas da seção 07.</li>
            </ul>
            <p>A extensão não utiliza os dados para publicidade personalizada, criação de perfil comercial, análise de crédito, concessão de empréstimos ou venda de informações.</p>
          </section>

          <section id="armazenamento">
            <SectionTitle number="05">Armazenamento local e retenção</SectionTitle>
            <p>Os replays são armazenados no IndexedDB pertencente à extensão no perfil local do Chrome.</p>
            <p>Estados técnicos de erro podem ser mantidos no <code>chrome.storage.local</code> para que o popup informe problemas ocorridos durante a captura.</p>
            <p>A extensão mantém no máximo:</p>
            <ul>
              <li><strong>100 partidas armazenadas;</strong></li>
              <li><strong>200 MB de replays compactados.</strong></li>
            </ul>
            <p>Quando um desses limites é atingido, a extensão pode remover automaticamente apenas partidas concluídas que já tenham sido exportadas ou sincronizadas. Gravações que ainda não possuem cópia não são removidas silenciosamente.</p>
            <p>O usuário pode excluir individualmente os replays pelo popup da extensão.</p>
            <p>Quando o usuário solicita um download, um arquivo JSON é salvo na pasta <code>Downloads/Talishar Local History</code>. Esse arquivo permanece sob o controle do usuário, inclusive após a desinstalação da extensão.</p>
          </section>

          <section id="sincronizacao">
            <SectionTitle number="06">Sincronização com o Hyperdriver</SectionTitle>
            <div className={styles.notice}>
              <strong>Aviso importante</strong>
              <p>A sincronização é automática. Ao acessar <code>hyperdriver.com.br</code> ou <code>beta.hyperdriver.com.br</code> com uma sessão autenticada, a extensão procura replays concluídos que ainda não tenham sido enviados para aquele ambiente e os transmite para a conta do usuário.</p>
            </div>
            <p>Os ambientes de produção e beta possuem estados de sincronização independentes. Um replay somente é enviado para o ambiente que o usuário acessar enquanto estiver autenticado.</p>
            <p>Os dados enviados incluem apenas o documento compacto necessário para armazenar, exibir e analisar o replay.</p>
            <p>Campos de autenticação, cookies, senhas, tokens e conteúdo de chat não são incluídos na sincronização.</p>
            <p>A sessão autenticada já existente no site é utilizada para associar o replay à conta correta. A extensão não lê nem armazena diretamente a senha utilizada para acessar o Hyperdriver.</p>
          </section>

          <section id="analise">
            <SectionTitle number="07">Análises e aprendizado coletivo</SectionTitle>
            <p>O Hyperdriver pode derivar do replay observações de decisão, análises de mão e exemplos destinados a avaliar e melhorar o treinador pós-partida. O objetivo principal do avaliador é estimar a probabilidade de vitória usando apenas as informações disponíveis no instante da escolha. A análise é versionada e mantida separada do replay original, para permitir recálculo sem alterar a partida.</p>
            <p>Para aprendizado coletivo, o exemplo derivado exclui nome de usuário, URL, identificador da partida, link do deck e conteúdo bruto do replay. A conta é substituída por um código pseudônimo criptográfico. Pseudonimização é uma salvaguarda e não transforma automaticamente o dado em anônimo.</p>
            <div className={styles.notice}>
              <strong>Limites e salvaguardas</strong>
              <p>Não será feito backfill de replays históricos para aprendizado coletivo sem avaliação documentada da base legal aplicável. Novos usos dependem de finalidade explícita, necessidade, transparência, balanceamento e medidas de segurança. A exclusão de um replay remove também suas observações e exemplos derivados do conjunto usado em versões futuras.</p>
            </div>
            <p>O feedback opcional “útil” ou “não útil” serve para monitorar a qualidade da análise. Ele não altera automaticamente o modelo nem a recomendação exibida.</p>
            <p>Recomendações de baixa confiança não são apresentadas como melhoria. Uma única derrota não produz recomendação de troca de carta; sinais de construção de deck exigem repetição e intervalo de confiança que exclua efeito neutro.</p>
            <p>As salvaguardas seguem os princípios do <a href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm">artigo 6º da LGPD</a> e o <a href="https://www.gov.br/anpd/pt-br/centrais-de-conteudo/materiais-educativos-e-publicacoes/guia_orientativo_hipoteses_legais_tratamento_de_dados_pessoais_legitimo_interesse">guia orientativo da ANPD</a>.</p>
          </section>

          <section id="compartilhamento">
            <SectionTitle number="08">Compartilhamento de informações</SectionTitle>
            <p>Os replays sincronizados são compartilhados exclusivamente com o ambiente do Hyperdriver acessado pelo usuário.</p>
            <p>Os dados também podem ser processados por fornecedores técnicos contratados para hospedar, armazenar, proteger e transmitir o serviço Hyperdriver, estritamente para essas finalidades.</p>
            <p>O Hyperdriver não:</p>
            <ul>
              <li>Vende dados pessoais ou replays.</li>
              <li>Compartilha dados com anunciantes.</li>
              <li>Compartilha dados com corretores de dados.</li>
              <li>Utiliza dados para publicidade personalizada.</li>
              <li>Utiliza dados para determinar capacidade de crédito.</li>
              <li>Transfere dados para finalidades incompatíveis com o propósito declarado da extensão.</li>
            </ul>
            <p>Informações poderão ser fornecidas quando exigidas por lei ou quando forem necessárias para investigar fraude, abuso ou incidente de segurança.</p>
          </section>

          <section id="retencao">
            <SectionTitle number="09">Retenção no Hyperdriver</SectionTitle>
            <p>Os replays sincronizados permanecem associados à conta do usuário pelo período necessário para fornecer o histórico e os recursos de análise do Hyperdriver.</p>
            <p>O usuário pode solicitar informações ou a exclusão dos dados sincronizados utilizando o canal de suporte indicado no site oficial ou na página da extensão na Chrome Web Store. A exclusão do replay também apaga, por vínculo técnico, as observações, análises, feedbacks e exemplos derivados associados.</p>
            <p>Determinadas informações poderão ser mantidas por período adicional quando necessário para segurança, prevenção de fraude, cumprimento de obrigação legal ou resolução de disputas.</p>
          </section>

          <section id="seguranca">
            <SectionTitle number="10">Segurança</SectionTitle>
            <p>A extensão adota medidas técnicas destinadas a proteger as informações, incluindo:</p>
            <ul>
              <li>Uso de HTTPS durante a sincronização.</li>
              <li>Validação da origem das mensagens.</li>
              <li>Limites de tamanho e frequência para os eventos capturados.</li>
              <li>Validação dos arquivos JSON importados.</li>
              <li>Remoção de campos conhecidos de autenticação.</li>
              <li>Lista fechada de campos permitidos para alternativas e escolhas de decisão.</li>
              <li>Separação entre replay bruto, observações derivadas e versões do avaliador.</li>
              <li>Armazenamento isolado no perfil da extensão.</li>
              <li>Restrição da execução aos domínios necessários.</li>
            </ul>
            <p>Nenhum método de armazenamento ou transmissão é completamente isento de riscos. O usuário deve manter o Chrome e a extensão atualizados e proteger o acesso ao seu perfil e à sua conta.</p>
          </section>

          <section id="controle">
            <SectionTitle number="11">Controle do usuário</SectionTitle>
            <p>O usuário pode:</p>
            <ul>
              <li>Consultar os replays mantidos localmente pelo popup.</li>
              <li>Baixar uma cópia em formato JSON.</li>
              <li>Excluir individualmente os replays locais.</li>
              <li>Desinstalar a extensão para interromper novas capturas.</li>
              <li>Solicitar informações ou exclusão dos dados sincronizados por meio do suporte do Hyperdriver.</li>
              <li>Enviar, de forma opcional, feedback sobre a utilidade de uma análise.</li>
            </ul>
            <p>A remoção de um replay local não exclui automaticamente uma cópia que já tenha sido sincronizada. A exclusão da cópia sincronizada deve ser solicitada ou realizada no ambiente do Hyperdriver.</p>
          </section>

          <section id="uso-limitado">
            <SectionTitle number="12">Uso Limitado</SectionTitle>
            <p>O uso das informações obtidas pela extensão está limitado ao propósito declarado e seguirá a <a href="https://developer.chrome.com/docs/webstore/program-policies/limited-use">Política de Dados do Usuário da Chrome Web Store</a>, incluindo os requisitos de Uso Limitado.</p>
            <p>O acesso humano aos dados somente ocorrerá:</p>
            <ul>
              <li>Mediante solicitação ou autorização do usuário para atendimento de suporte.</li>
              <li>Quando necessário para investigar abuso ou incidente de segurança.</li>
              <li>Quando exigido por lei.</li>
              <li>De forma agregada e anonimizada para operações internas permitidas.</li>
            </ul>
          </section>

          <section id="alteracoes">
            <SectionTitle number="13">Alterações desta política</SectionTitle>
            <p>Esta política poderá ser atualizada para refletir mudanças na extensão, no Hyperdriver ou nos requisitos legais e da Chrome Web Store.</p>
            <p>A data da última atualização será informada no início deste documento. Mudanças relevantes no tratamento de dados serão divulgadas antes de entrarem em vigor.</p>
          </section>

          <section id="contato">
            <SectionTitle number="14">Contato</SectionTitle>
            <p>Dúvidas, solicitações de acesso ou pedidos de exclusão podem ser encaminhados pelo canal de suporte disponibilizado no site oficial:</p>
            <a className={styles.contactLink} href="https://hyperdriver.com.br">hyperdriver.com.br</a>
          </section>

          <footer className={styles.disclaimer}>
            Hyperdriver é um projeto independente e não representa afiliação oficial com Talishar ou Legend Story Studios.
          </footer>
        </article>
      </div>
    </main>
  );
}

function SectionTitle({ children, number }: { children: React.ReactNode; number: string }) {
  return (
    <h2><span>{number}</span>{children}</h2>
  );
}
