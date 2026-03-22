cask "tokenmeter" do
  version "0.1.1"
  sha256 "f1b04778e72a5e4ac525f668411b8f2302589e9496f2b8988f38d01ce1f07b5e"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end
