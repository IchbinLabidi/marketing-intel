export const metadata = { title: "Terms of service" };

/** Public terms of service, linked from the TikTok, Google and Meta app settings. */
export default function TermsOfService() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-16 text-[13px] leading-relaxed">
      <h1 className="text-lg font-semibold">Orix Signals terms of service</h1>
      <p>
        Orix Signals is a marketing workspace used by invited teams to plan, approve, publish and analyse social media content for their own
        brands. By using Orix Signals you agree to these terms. Contact: elyes.lab@gmail.com.
      </p>

      <h2 className="font-semibold">Who can use Orix Signals</h2>
      <p>
        Access is by invitation only. You are responsible for the accounts you connect and must be allowed to publish on behalf of them.
      </p>

      <h2 className="font-semibold">Publishing</h2>
      <p>
        Orix Signals publishes only content that a team member has approved and explicitly chosen to publish, to the account and network that
        member selected. You remain responsible for the content you publish and for following the rules of each network (Facebook,
        Instagram, TikTok, YouTube, LinkedIn), including their community guidelines and music and branded-content policies.
      </p>

      <h2 className="font-semibold">Your data</h2>
      <p>
        Your content and connected accounts stay yours. How Orix Signals handles data is described in the{" "}
        <a className="underline" href="/privacy">privacy policy</a>. You can disconnect any account at any time from a project&apos;s
        Integrations page.
      </p>

      <h2 className="font-semibold">Availability</h2>
      <p>
        Orix Signals is provided as is. Networks can change or limit their APIs, which can temporarily stop a feature such as publishing or
        statistics. Orix Signals is not liable for posts a network rejects, delays or removes.
      </p>

      <h2 className="font-semibold">Changes</h2>
      <p>These terms can be updated; the current version is always on this page.</p>
    </main>
  );
}
