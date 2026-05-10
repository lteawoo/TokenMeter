cask "tokenmeter" do
  version "0.2.0"
  sha256 "da67b37385a12de36e09a5d0871213ed07226fb86d3b1335451bbac7e9968eea"

  url "https://github.com/lteawoo/TokenMeter/releases/download/v#{version}/TokenMeter_#{version}_aarch64.dmg"
  name "TokenMeter"
  desc "Local-first desktop app for understanding Codex usage"
  homepage "https://github.com/lteawoo/TokenMeter"

  app "TokenMeter.app"
end
