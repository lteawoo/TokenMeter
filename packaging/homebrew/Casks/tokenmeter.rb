cask "tokenmeter" do
  version "0.1.8"
  sha256 "825648f8977cf18fc4bf24c840aa0fd2ef8a115bbebd9c31b4880f7537663292"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end
