cask "tokenmeter" do
  version "0.1.7"
  sha256 "5e26c4691cc6e4593ed2b4cf8b30cb5b835f15a97827558a32fb19b1bd96f34a"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end
