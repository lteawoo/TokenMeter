cask "tokenmeter" do
  version "0.1.0"
  sha256 "80b33983a893883ce0bef970dd2909998f717259ce11741ff4e4633018978b48"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end
