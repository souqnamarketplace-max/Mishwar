import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, MessagingDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Configure Firebase. Reads GoogleService-Info.plist at the
        // root of the App bundle (verified present at
        // ios/App/App/GoogleService-Info.plist by the push setup).
        // MUST happen before anything that touches Firebase services.
        FirebaseApp.configure()

        // Wire up the messaging delegate so we receive FCM tokens via
        // the messaging:didReceiveRegistrationToken: callback below.
        Messaging.messaging().delegate = self

        return true
    }

    // ─── APNS token handoff ────────────────────────────────────────
    // Called by iOS after registerForRemoteNotifications() succeeds.
    // We hand the raw APNS token to Firebase, which exchanges it for
    // an FCM token. The FCM token then arrives via the
    // messaging:didReceiveRegistrationToken: callback (below), which
    // Capacitor's plugin picks up and surfaces to JS as the
    // 'registration' event.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Messaging.messaging().apnsToken = deviceToken
    }

    // Called by iOS if registerForRemoteNotifications() fails. We log
    // and let Capacitor's plugin surface the error to JS via the
    // 'registrationError' event.
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NSLog("APNS registration failed: \(error.localizedDescription)")
    }

    // ─── FCM token callback ────────────────────────────────────────
    // Fired by Firebase whenever an FCM token is issued or refreshed.
    // We forward to Capacitor's PushNotifications bridge so the JS
    // 'registration' listener (in src/lib/pushNotifications.js) fires
    // and the token gets upserted into device_tokens.
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken else { return }
        NotificationCenter.default.post(
            name: Notification.Name.capacitorDidRegisterForRemoteNotifications,
            object: token.data(using: .utf8)
        )
    }

    // ─── Lifecycle (unchanged from Capacitor template) ────────────
    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    // ─── URL scheme + Universal Links (unchanged) ─────────────────
    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

