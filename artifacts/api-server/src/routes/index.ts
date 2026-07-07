import { Router, type IRouter } from "express";
import healthRouter from "./health";
import chatRouter from "./chat";
import authRouter from "./auth";
import adminRouter from "./admin";
import webhooksRouter from "./webhooks";
import embedRouter from "./embed";
import reviewsRouter from "./reviews";
import leadsRouter from "./leads";
import emailsRouter from "./emails";
import notificationsRouter from "./notifications";
import buyRouter from "./buy";
import availabilityRouter from "./availability";
import upgradesRouter from "./upgrades";
import googleOAuthRouter from "./googleOAuth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(chatRouter);
router.use(authRouter);
router.use(embedRouter);
router.use(webhooksRouter);
router.use("/admin", adminRouter);
router.use(reviewsRouter);
router.use(leadsRouter);
router.use(emailsRouter);
router.use(notificationsRouter);
router.use(buyRouter);
router.use(availabilityRouter);
router.use(upgradesRouter);
router.use(googleOAuthRouter);

export default router;
