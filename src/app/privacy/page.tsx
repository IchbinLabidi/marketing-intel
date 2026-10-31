export const metadata = { title: "Privacy policy" };

/** Public privacy policy, linked from the Google and Meta consent screens. */
export default function PrivacyPolicy() {
  return (
    <main className="mx-auto max-w-2xl space-y-4 px-6 py-16 text-[13px] leading-relaxed">
      <h1 className="text-lg font-semibold">Orix Signals privacy policy</h1>
      <p>
        Orix Signals is a marketing workspace used by invited teams to plan, publish and analyse social media content. This page explains
        what data Orix Signals handles when you connect an account and how you can remove it. Contact: elyes.lab@gmail.com.
      </p>

      <h2 className="font-semibold">Accounts you connect</h2>
      <p>
        When a team member connects Facebook, Instagram, YouTube, LinkedIn, TikTok or Google Drive, Orix Signals stores the access tokens
        encrypted on its servers and uses them only for the actions the team triggers: reading the project&apos;s own posts and
        metrics, and publishing posts the team has approved. Tokens are never shown in the browser or written to logs.
      </p>

      <h2 className="font-semibold">Google Drive</h2>
      <p>
        Orix Signals asks only for the <span className="font-mono">drive.file</span> permission: it can access the individual files you
        pick in Google&apos;s file picker, never the rest of your Drive. For a picked file Orix Signals saves its id, name, type, size and
        thumbnail link, and downloads its content only when a post using it is published, to send it to the social network you chose.
        Orix Signals never changes a file&apos;s sharing settings or makes it public. When Instagram needs a link to the media, Orix Signals keeps
        a temporary private copy for at most the time Instagram takes to fetch it, then deletes it. It also reads your Google account
        email to show which account is connected.
      </p>
      <p>
        Orix Signals&apos;s use and transfer of information received from Google APIs adheres to the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
        including the Limited Use requirements. Google data is not sold, not used for advertising and not used to train AI models.
      </p>

      <h2 className="font-semibold">Sharing</h2>
      <p>
        Data is visible only to members of the workspace it belongs to. It is sent to third parties only when publishing to the social
        network you selected, and to the hosting and database providers that run Orix Signals.
      </p>

      <h2 className="font-semibold">Removing your data</h2>
      <p>
        Disconnecting an account in a project&apos;s Integrations page deletes its tokens and revokes Orix Signals&apos;s access. You can also
        revoke access at any time from your Google Account (Security → Third-party connections) or Facebook settings. To delete
        everything stored for your workspace, write to the contact address above.
      </p>
    </main>
  );
}
